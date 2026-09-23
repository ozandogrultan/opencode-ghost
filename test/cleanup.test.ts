import { test, expect } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ghost from "../src/tui"

test("recovers only abandoned Ghost sessions and clears their markers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghost-recovery-"))
  const orphan = "ses_orphan"
  const unrelated = "ses_unrelated"
  for (const id of [orphan, unrelated]) {
    writeFileSync(join(dir, `id-${id}`), JSON.stringify({ directory: "/some/project", pid: 99999999 }))
  }

  const deleted: string[] = []
  const requests: Array<{ sessionID: string; directory: string }> = []
  const api = {
    client: {
      session: {
        get: async (request: { sessionID: string; directory: string }) => {
          requests.push(request)
          return { data: { title: request.sessionID === orphan ? "ghost-hidden" : "User session" } }
        },
        delete: async ({ sessionID }: { sessionID: string }) => {
          deleted.push(sessionID)
          return { data: true }
        },
      },
    },
    event: { on: () => () => {} },
    keymap: { registerLayer: () => () => {} },
    slots: { register: () => {} },
    lifecycle: { onDispose: () => {} },
  }

  try {
    await ghost.tui(api as any, { internalSessionMarkerDir: dir }, {} as any)
    for (let i = 0; i < 50 && existsSync(join(dir, `id-${orphan}`)); i++) await Bun.sleep(10)
    expect(deleted).toEqual([orphan])
    expect(requests).toContainEqual({ sessionID: orphan, directory: "/some/project" })
    expect(existsSync(join(dir, `id-${orphan}`))).toBe(false)
    expect(existsSync(join(dir, `id-${unrelated}`))).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
