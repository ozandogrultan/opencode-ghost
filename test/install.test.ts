import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const repoDir = join(import.meta.dir, "..")

const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function sandbox(tui: (configDir: string) => unknown | null) {
  const root = mkdtempSync(join(tmpdir(), "ghost-install-"))
  roots.push(root)

  const config = join(root, "config")
  const configDir = join(config, "opencode")
  const binDir = join(root, "bin")
  mkdirSync(configDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })

  const opencode = join(binDir, "opencode")
  writeFileSync(
    opencode,
    '#!/usr/bin/env bash\n[ "$1" = debug ] && [ "$2" = paths ] && echo "config $GHOST_TEST_CONFIG"\n',
  )
  chmodSync(opencode, 0o755)

  const tuiPath = join(configDir, "tui.json")
  const initial = tui(configDir)
  if (initial !== null) writeFileSync(tuiPath, JSON.stringify(initial, null, 2) + "\n")

  const result = Bun.spawnSync(["bash", join(repoDir, "install.sh")], {
    cwd: repoDir,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, XDG_CONFIG_HOME: config, GHOST_TEST_CONFIG: configDir },
    stdout: "pipe",
    stderr: "pipe",
  })

  return { result, configDir, readTui: () => JSON.parse(readFileSync(tuiPath, "utf8")) }
}

const specs = (config: { plugin: unknown[] }) =>
  config.plugin.map((item) => (Array.isArray(item) ? item[0] : item))

describe("install.sh tui.json registration", () => {
  test("keeps a relative entry and its options without adding a duplicate", () => {
    const options = { model: "anthropic/claude-haiku-4-5", acceptKeys: ["tab", "right"] }
    const { result, readTui } = sandbox(() => ({ plugin: [["./plugins/opencode-ghost/tui.tsx", options]] }))

    expect(result.exitCode).toBe(0)
    const config = readTui()
    expect(config.plugin).toHaveLength(1)
    expect(specs(config)).toEqual(["./plugins/opencode-ghost/tui.tsx"])
    expect(config.plugin[0][1]).toEqual(options)
  })

  test("keeps a path without a ./ prefix", () => {
    const { result, readTui } = sandbox(() => ({ plugin: ["plugins/opencode-ghost/tui.tsx"] }))

    expect(result.exitCode).toBe(0)
    const config = readTui()
    expect(specs(config)).toEqual(["plugins/opencode-ghost/tui.tsx"])
  })

  test("keeps an absolute entry", () => {
    const { result, readTui, configDir } = sandbox((dir) => ({ plugin: [`${dir}/plugins/opencode-ghost/tui.tsx`] }))

    expect(result.exitCode).toBe(0)
    const config = readTui()
    expect(specs(config)).toEqual([`${configDir}/plugins/opencode-ghost/tui.tsx`])
  })

  test("preserves other plugins and appends after them", () => {
    const { result, readTui, configDir } = sandbox(() => ({ plugin: ["./plugins/statusline.tsx"] }))

    expect(result.exitCode).toBe(0)
    const config = readTui()
    expect(specs(config)).toEqual([
      "./plugins/statusline.tsx",
      `${configDir}/plugins/opencode-ghost/tui.tsx`,
    ])
  })

  test("creates tui.json when it is missing", () => {
    const { result, readTui } = sandbox(() => null)

    expect(result.exitCode).toBe(0)
    const config = readTui()
    expect(specs(config)).toHaveLength(1)
    expect(specs(config)[0]).toMatch(/plugins\/opencode-ghost\/tui\.tsx$/)
  })

  test("installs to an explicit target directory", () => {
    const root = mkdtempSync(join(tmpdir(), "ghost-target-"))
    roots.push(root)
    const explicitDir = join(root, "custom-opencode")
    mkdirSync(explicitDir, { recursive: true })

    const result = Bun.spawnSync(["bash", join(repoDir, "install.sh"), explicitDir], {
      cwd: repoDir,
      env: { ...process.env, PATH: process.env.PATH },
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(result.exitCode).toBe(0)
    const tuiContent = JSON.parse(readFileSync(join(explicitDir, "tui.json"), "utf8"))
    expect(specs(tuiContent)).toHaveLength(1)
    expect(specs(tuiContent)[0]).toBe(`${explicitDir}/plugins/opencode-ghost/tui.tsx`)
  })
})
