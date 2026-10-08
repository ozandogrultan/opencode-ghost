import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const repoDir = join(import.meta.dir, "..")

const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function sandbox(options: { cli?: (configDir: string) => unknown | null; tui?: (configDir: string) => unknown | null; cliRaw?: string; tuiRaw?: string; before?: (configDir: string) => void; all?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "ghost-install-"))
  roots.push(root)

  const config = join(root, "config with spaces")
  const configDir = join(config, "opencode")
  const binDir = join(root, "bin")
  mkdirSync(configDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })
  const home = join(root, "home")
  mkdirSync(home, { recursive: true })

  const opencode = join(binDir, "opencode")
  writeFileSync(
    opencode,
    '#!/usr/bin/env bash\n[ "$1" = debug ] && [ "$2" = paths ] && echo "config $GHOST_TEST_CONFIG"\n',
  )
  chmodSync(opencode, 0o755)

  const cliPath = join(configDir, "cli.json")
  const tuiPath = join(configDir, "tui.json")
  const initialCli = options.cli?.(configDir) ?? null
  const initialTui = options.tui?.(configDir) ?? null
  if (initialCli !== null) writeFileSync(cliPath, JSON.stringify(initialCli, null, 2) + "\n")
  if (initialTui !== null) writeFileSync(tuiPath, JSON.stringify(initialTui, null, 2) + "\n")
  if (options.cliRaw !== undefined) writeFileSync(cliPath, options.cliRaw)
  if (options.tuiRaw !== undefined) writeFileSync(tuiPath, options.tuiRaw)
  options.before?.(configDir)

  const result = Bun.spawnSync(["bash", join(repoDir, "install.sh"), ...(options.all ? ["--all"] : [])], {
    cwd: repoDir,
    env: { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH}`, XDG_CONFIG_HOME: config, GHOST_TEST_CONFIG: configDir },
    stdout: "pipe",
    stderr: "pipe",
  })

  return {
    result,
    configDir,
    home,
    rawCli: () => readFileSync(cliPath, "utf8"),
    rawTui: () => readFileSync(tuiPath, "utf8"),
    readCli: () => JSON.parse(readFileSync(cliPath, "utf8")),
    readTui: () => JSON.parse(readFileSync(tuiPath, "utf8")),
    tuiExists: () => existsSync(tuiPath),
  }
}

const specs = (config: { plugins: unknown[] }) =>
  config.plugins.map((item) => (typeof item === "object" && item ? (item as { package: string }).package : item))

function markInstallation(dir: string) {
  const dest = join(dir, "plugins/opencode-ghost")
  mkdirSync(dest, { recursive: true })
  for (const name of ["tui.tsx", "builtins.ts", "completion.ts"]) writeFileSync(join(dest, name), `v1 ${name}`)
}

function expectInstallationUnchanged(dir: string) {
  for (const name of ["tui.tsx", "builtins.ts", "completion.ts"]) expect(readFileSync(join(dir, "plugins/opencode-ghost", name), "utf8")).toBe(`v1 ${name}`)
  expect(existsSync(join(dir, "plugins/opencode-ghost/lifecycle.ts"))).toBe(false)
}

describe("install.sh cli.json registration", () => {
  test("does not mutate old tui when CLI write fails", () => {
    const raw = '{"plugin":["opencode-ghost"]}'
    const run = sandbox({ tuiRaw: raw, before: (dir) => symlinkSync(join(dir, "missing/cli.json"), join(dir, "cli.json")) })
    expect(run.result.exitCode).not.toBe(0)
    expect(run.rawTui()).toBe(raw)
  })

  test("merges old options into an existing CLI registration without overriding CLI options", () => {
    const run = sandbox({ cli: () => ({ plugins: [{ package: "opencode-ghost", options: { maxChars: 42 } }] }), tui: () => ({ plugin: [["opencode-ghost", { maxChars: 80, model: "openai/gpt-6-luna-fast", endpoint: "removed" }]] }) })
    expect(run.result.exitCode).toBe(0)
    expect(run.readCli().plugins[0].options).toEqual({ maxChars: 42, model: "openai/gpt-6-luna-fast" })
    expect(run.readTui().plugin).toEqual([])
  })

  test("all installs to isolated XDG and existing HOME config, expanding old tilde paths", () => {
    const run = sandbox({ all: true, before: (dir) => {
      const standard = join(dir, "../../home/.config/opencode")
      mkdirSync(standard, { recursive: true })
      writeFileSync(join(standard, "tui.json"), JSON.stringify({ plugin: ["~/.config/opencode/plugins/opencode-ghost/tui.tsx"] }))
    } })
    expect(run.result.exitCode).toBe(0)
    const standard = join(run.home, ".config/opencode")
    expect(JSON.parse(readFileSync(join(standard, "tui.json"), "utf8")).plugin).toEqual([])
    expect(JSON.parse(readFileSync(join(standard, "cli.json"), "utf8")).plugins).toEqual([join(standard, "plugins/opencode-ghost")])
  })
  test("rejects malformed JSON, JSONC and non-object configs without touching either config", () => {
    for (const raw of ["{broken", "{ // comment\n}", "null", "[]", "1", '"text"', '{"plugins": {}}']) {
      const old = '{"plugin":["opencode-ghost"],"theme":"custom"}'
      const run = sandbox({ cliRaw: raw, tuiRaw: old, before: markInstallation })
      expect(run.result.exitCode).not.toBe(0)
      expect(run.rawCli()).toBe(raw)
      expect(run.rawTui()).toBe(old)
      expectInstallationUnchanged(run.configDir)
    }
  })

  test("rejects unparseable ghost legacy config before writing cli", () => {
    for (const raw of ['{broken "opencode-ghost"', '{ // opencode-ghost\n}', '{"plugin": "opencode-ghost"}']) {
      const cli = '{"plugins":["other"],"theme":"custom"}'
      const run = sandbox({ cliRaw: cli, tuiRaw: raw, before: markInstallation })
      expect(run.result.exitCode).not.toBe(0)
      expect(run.rawCli()).toBe(cli)
      expect(run.rawTui()).toBe(raw)
      expectInstallationUnchanged(run.configDir)
    }
  })

  test("unrelated legacy JSONC and invalid configs do not block installation", () => {
    for (const name of ["tui.json", "tui.jsonc"]) {
      for (const raw of ['{ // comment\n "plugin": ["other"] }', "{broken", "null", "[]", "false", '{"plugin": 1}']) {
        const run = sandbox({ before: (dir) => writeFileSync(join(dir, name), raw) })
        expect(run.result.exitCode).toBe(0)
        expect(readFileSync(join(run.configDir, name), "utf8")).toBe(raw)
        expect(run.readCli().plugins).toEqual([join(run.configDir, "plugins/opencode-ghost")])
        expect(run.result.stderr.toString()).toContain("Warning:")
      }
    }
  })

  test("legacy tui.jsonc migrates JSON registrations and rejects unparseable ghost references", () => {
    const valid = sandbox({ before: (dir) => writeFileSync(join(dir, "tui.jsonc"), '{"plugin":["opencode-ghost"]}') })
    expect(valid.result.exitCode).toBe(0)
    expect(JSON.parse(readFileSync(join(valid.configDir, "tui.jsonc"), "utf8")).plugin).toEqual([])
    const raw = '{ // comment\n "plugin": ["opencode-ghost"] }'
    const invalid = sandbox({ before: (dir) => { markInstallation(dir); writeFileSync(join(dir, "tui.jsonc"), raw) } })
    expect(invalid.result.exitCode).not.toBe(0)
    expectInstallationUnchanged(invalid.configDir)
    expect(readFileSync(join(invalid.configDir, "tui.jsonc"), "utf8")).toBe(raw)
  })

  test("recognizes package and old relative, absolute, source and file URL registrations", () => {
    for (const spec of ["opencode-ghost", "opencode-ghost@0.5.0", "./plugins/opencode-ghost/tui.tsx", "./plugins/opencode-ghost/src/tui.tsx", "absolute", "url"]) {
      const run = sandbox({ tui: (dir) => ({ theme: "custom", plugin: [[spec === "absolute" ? `${dir}/plugins/opencode-ghost/tui.tsx` : spec === "url" ? `file://${dir}/plugins/opencode-ghost/tui.tsx` : spec, { model: "openai/gpt-6-luna-fast", endpoint: "removed", apiKey: "fixture-only", internalSessionMarkerDir: "removed", argHints: {}, extra: true }], "other"] }) })
      expect(run.result.exitCode).toBe(0)
      expect(run.readCli().plugins[0].options).toEqual({ model: "openai/gpt-6-luna-fast", extra: true })
      expect(run.readTui()).toEqual({ theme: "custom", plugin: ["other"] })
    }
  })

  test("normalizes owned CLI registrations to the installed directory and strips removed options", () => {
    for (const spec of ["opencode-ghost", "opencode-ghost@0.5.0", "./plugins/opencode-ghost", "./plugins/opencode-ghost/tui.tsx", "./plugins/opencode-ghost/src", "./plugins/opencode-ghost/src/tui.tsx"]) {
      const run = sandbox({ cli: () => ({ theme: "custom", plugins: [{ package: spec, options: { apiKey: "fixture-only", endpoint: "removed", maxChars: 42 } }, { package: "other", options: { endpoint: "keep" } }] }) })
      expect(run.result.exitCode).toBe(0)
      expect(run.readCli()).toEqual({ theme: "custom", plugins: [{ package: join(run.configDir, "plugins/opencode-ghost"), options: { maxChars: 42 } }, { package: "other", options: { endpoint: "keep" } }] })
    }
  })

  test("deduplicates owned CLI entries, preserving safe options and unrelated entries", () => {
    const unrelated = { package: "./other/opencode-ghost/tui.tsx", options: { endpoint: "keep" } }
    const run = sandbox({ cli: (dir) => ({ plugins: ["other", "opencode-ghost@0.5.0", unrelated, { package: "./plugins/opencode-ghost/src/tui.tsx", enabled: true, options: { maxChars: 42, endpoint: "removed" } }, `file://${dir}/plugins/opencode-ghost`] }), tui: () => ({ plugin: [["opencode-ghost", { model: "openai/gpt-6-luna-fast" }]] }) })
    expect(run.result.exitCode).toBe(0)
    expect(run.readCli().plugins).toEqual(["other", { package: join(run.configDir, "plugins/opencode-ghost"), enabled: true, options: { model: "openai/gpt-6-luna-fast", maxChars: 42 } }, unrelated])
    expect(run.readTui().plugin).toEqual([])
  })

  test("removes stale owned sources without removing unrelated files in isolated HOME/XDG", () => {
    const run = sandbox({ all: true, before: (dir) => {
      const dest = join(dir, "plugins/opencode-ghost")
      mkdirSync(dest, { recursive: true })
      for (const name of ["builtins.ts", "completion.ts", "unrelated.ts"]) writeFileSync(join(dest, name), "fixture")
    } })
    expect(run.result.exitCode).toBe(0)
    expect(existsSync(join(run.configDir, "plugins/opencode-ghost/builtins.ts"))).toBe(false)
    expect(existsSync(join(run.configDir, "plugins/opencode-ghost/completion.ts"))).toBe(false)
    expect(existsSync(join(run.configDir, "plugins/opencode-ghost/unrelated.ts"))).toBe(true)
    expect(existsSync(join(run.home, ".config/opencode/cli.json"))).toBe(false)
  })
  test("creates cli.json when it is missing", () => {
    const { result, readCli } = sandbox({})

    expect(result.exitCode).toBe(0)
    const config = readCli()
    expect(specs(config)).toHaveLength(1)
    expect(specs(config)[0]).toMatch(/plugins\/opencode-ghost$/)
  })

  test("keeps an existing entry without adding a duplicate", () => {
    const { result, readCli, configDir } = sandbox({
      cli: (dir) => ({ plugins: [`${dir}/plugins/opencode-ghost/tui.tsx`] }),
    })

    expect(result.exitCode).toBe(0)
    const config = readCli()
    expect(specs(config)).toHaveLength(1)
    expect(specs(config)).toEqual([`${configDir}/plugins/opencode-ghost`])
  })

  test("preserves other plugins and appends after them", () => {
    const { result, readCli } = sandbox({ cli: () => ({ plugins: ["opencode.other"] }) })

    expect(result.exitCode).toBe(0)
    const config = readCli()
    expect(specs(config)[0]).toBe("opencode.other")
    expect(specs(config)[1]).toMatch(/plugins\/opencode-ghost$/)
  })

  test("migrates a V1 tui.json registration, carrying its options and removing the old entry", () => {
    const options = { model: "anthropic/claude-haiku-4-5", acceptKeys: ["tab", "right"] }
    const { result, readCli, readTui } = sandbox({
      tui: () => ({ plugin: [["./plugins/opencode-ghost/tui.tsx", options]] }),
    })

    expect(result.exitCode).toBe(0)
    const cli = readCli()
    expect(cli.plugins).toHaveLength(1)
    expect((cli.plugins[0] as { options: unknown }).options).toEqual(options)
    expect(readTui().plugin).toEqual([])
  })

  test("leaves unrelated tui.json plugins alone", () => {
    const { result, readTui } = sandbox({ tui: () => ({ plugin: ["./plugins/statusline.tsx"] }) })

    expect(result.exitCode).toBe(0)
    expect(readTui().plugin).toEqual(["./plugins/statusline.tsx"])
  })

  test("installs to an explicit target directory", () => {
    const root = mkdtempSync(join(tmpdir(), "ghost-target-"))
    roots.push(root)
    const explicitDir = join(root, "custom-opencode")
    mkdirSync(explicitDir, { recursive: true })

    const result = Bun.spawnSync(["bash", join(repoDir, "install.sh"), explicitDir], {
      cwd: repoDir,
      env: { ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, "config"), PATH: process.env.PATH },
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(result.exitCode).toBe(0)
    const cliContent = JSON.parse(readFileSync(join(explicitDir, "cli.json"), "utf8"))
    expect(specs(cliContent)).toHaveLength(1)
    expect(specs(cliContent)[0]).toBe(`${explicitDir}/plugins/opencode-ghost`)
  })
})
