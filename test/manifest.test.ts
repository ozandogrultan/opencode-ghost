import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")

function read(path: string) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"))
}

test("declares OpenTUI versions the bundled OpenCode plugin accepts", () => {
  const host = read("node_modules/@opencode/plugin/package.json")
  const peers = Object.entries(host.peerDependencies ?? {})
    .filter(([name]) => name.startsWith("@opentui/"))
    .map(([name, range]) => [name, String(range)] as [string, string])
  expect(peers.length).toBeGreaterThan(0)
  for (const [name, range] of peers) {
    expect(read("package.json").dependencies?.[name]).toBeString()
    const installed = read(`node_modules/${name}/package.json`).version
    expect(Bun.semver.satisfies(installed, range)).toBe(true)
  }
})
