import { test, expect } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ghost from "../src/tui"

function baseApi(overrides: Record<string, unknown> = {}) {
  const handlers: Record<string, Array<(event: unknown) => void>> = {}
  return {
    api: {
      client: {
        session: {
          get: async () => {
            throw new Error("not mocked")
          },
          delete: async () => ({ data: true }),
          list: async () => ({ data: [] }),
          create: async () => {
            throw new Error("not mocked")
          },
          prompt: async () => {
            throw new Error("not mocked")
          },
        },
      },
      state: {
        config: {},
        path: { directory: "/some/project" },
        session: {
          get: () => ({ directory: "/some/project" }),
          messages: () => [],
        },
        part: () => [],
      },
      route: { current: { name: "home" as const } },
      kv: { get: () => true, set: () => {} },
      event: {
        on: (name: string, handler: (event: unknown) => void) => {
          ;(handlers[name] ??= []).push(handler)
          return () => {}
        },
      },
      keymap: { registerLayer: () => () => {} },
      slots: { register: () => {} },
      lifecycle: { onDispose: () => {} },
      ...overrides,
    } as any,
    handlers,
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

test("recovers only abandoned Ghost sessions and clears their markers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghost-recovery-"))
  const orphan = "ses_orphan"
  // Markers are authoritative proof this plugin created the session (the
  // server auto-titles hidden sessions, so a title check here would protect
  // real orphans forever). Non-ghost sessions have no marker and are covered
  // by the list sweep, which must leave them alone.
  writeFileSync(join(dir, `id-${orphan}`), JSON.stringify({ directory: "/some/project", pid: 99999999 }))
  const old = Date.now() - 60_000

  const deleted: Array<{ sessionID: string; directory?: string }> = []
  const { api } = baseApi({
    client: {
      session: {
        get: async () => ({ data: { title: "ghost-hidden" } }),
        delete: async (request: { sessionID: string; directory?: string }) => {
          deleted.push(request)
          return { data: true }
        },
        list: async () => ({
          data: [
            { id: "ses_user", title: "User session", metadata: {}, directory: "/some/project", time: { created: old, updated: old } },
          ],
        }),
      },
    },
  })

  let dispose!: () => void
  ;(api.lifecycle as { onDispose: (cb: () => void) => void }).onDispose = (cb) => {
    dispose = cb
  }

  try {
    await ghost.tui(api as any, { internalSessionMarkerDir: dir }, {} as any)
    await waitFor(() => !existsSync(join(dir, `id-${orphan}`)))
    expect(deleted).toEqual([{ sessionID: orphan, directory: "/some/project" }])
    expect(existsSync(join(dir, `id-${orphan}`))).toBe(false)
  } finally {
    dispose?.()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("marker sweep deletes retitled orphans (auto-title must not protect them)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghost-retitled-"))
  const retitled = "ses_retitled"
  writeFileSync(join(dir, `id-${retitled}`), JSON.stringify({ directory: "/some/project", pid: 99999999 }))

  const deleted: string[] = []
  let getCalls = 0
  const { api } = baseApi({
    client: {
      session: {
        // The server auto-titles the hidden session after the first prompt.
        get: async () => {
          getCalls++
          return { data: { title: "Write the tests", metadata: {} } }
        },
        delete: async ({ sessionID }: { sessionID: string }) => {
          deleted.push(sessionID)
          return { data: true }
        },
        list: async () => ({ data: [] }),
      },
    },
  })

  let dispose!: () => void
  ;(api.lifecycle as { onDispose: (cb: () => void) => void }).onDispose = (cb) => {
    dispose = cb
  }

  try {
    await ghost.tui(api as any, { internalSessionMarkerDir: dir }, {} as any)
    await waitFor(() => deleted.includes(retitled))
    expect(existsSync(join(dir, `id-${retitled}`))).toBe(false)
  } finally {
    dispose?.()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("list sweep deletes ghost sessions with no marker configured", async () => {
  const old = Date.now() - 60_000
  const sessions = [
    { id: "ses_ghost_old", title: "ghost-hidden", metadata: {}, directory: "/proj", time: { created: old, updated: old } },
    {
      id: "ses_tagged_retitled",
      title: "Something the server generated",
      metadata: { ghost: "opencode-ghost" },
      directory: "/proj",
      time: { created: old, updated: old },
    },
    { id: "ses_user", title: "Real work", metadata: {}, directory: "/proj", time: { created: old, updated: old } },
    {
      id: "ses_ghost_fresh",
      title: "ghost-hidden",
      metadata: {},
      directory: "/proj",
      time: { created: Date.now(), updated: Date.now() },
    },
  ]

  const deleted: string[] = []
  const { api } = baseApi({
    client: {
      session: {
        get: async () => {
          throw Object.assign(new Error("not found"), { status: 404 })
        },
        delete: async ({ sessionID }: { sessionID: string }) => {
          deleted.push(sessionID)
          return { data: true }
        },
        list: async () => ({ data: sessions }),
      },
    },
  })

  let dispose!: () => void
  ;(api.lifecycle as { onDispose: (cb: () => void) => void }).onDispose = (cb) => {
    dispose = cb
  }

  try {
    // No internalSessionMarkerDir: the list sweep must work with zero config.
    await ghost.tui(api as any, {}, {} as any)
    await waitFor(() => deleted.length >= 2)
    expect(new Set(deleted)).toEqual(new Set(["ses_ghost_old", "ses_tagged_retitled"]))
  } finally {
    dispose?.()
  }
})

test("failed generation deletes the hidden session with the parent directory", async () => {
  const created: unknown[] = []
  const prompted: unknown[] = []
  const deleted: unknown[] = []
  const { api, handlers } = baseApi({
    route: { current: { name: "session", params: { sessionID: "ses_visible" } } },
    state: {
      config: {},
      path: { directory: "/proj" },
      session: {
        get: () => ({ directory: "/proj" }),
        messages: () => [{ role: "user", id: "m1" }],
      },
      part: () => [{ type: "text", text: "hello there" }],
    },
    client: {
      session: {
        create: async (request: unknown) => {
          created.push(request)
          return { data: { id: "ses_hidden", directory: "/proj" } }
        },
        prompt: async (request: unknown) => {
          prompted.push(request)
          throw new Error("model unavailable")
        },
        delete: async (request: unknown) => {
          deleted.push(request)
          return { data: true }
        },
        list: async () => ({ data: [] }),
      },
    },
  })

  let dispose!: () => void
  ;(api.lifecycle as { onDispose: (cb: () => void) => void }).onDispose = (cb) => {
    dispose = cb
  }

  try {
    await ghost.tui(api as any, { idleDelayMs: 0 }, {} as any)
    for (const handler of handlers["session.idle"] ?? []) handler({ properties: { sessionID: "ses_visible" } })
    await waitFor(() => deleted.length >= 1)
    expect(created).toEqual([
      { title: "ghost-hidden", metadata: { ghost: "opencode-ghost" }, directory: "/proj" },
    ])
    expect(prompted).toEqual([
      expect.objectContaining({ sessionID: "ses_hidden", directory: "/proj" }),
    ])
    expect(deleted).toEqual([{ sessionID: "ses_hidden", directory: "/proj" }])
  } finally {
    dispose?.()
  }
})

test("hidden session disables every tool the server reports, not just the static built-ins", async () => {
  // Regression guard: the hidden session must never fall back to being a real
  // agent (e.g. calling an MCP tool and explaining its findings) just because
  // that tool wasn't in the static HIDDEN_TOOLS list.
  const prompted: Array<{ tools?: Record<string, boolean> }> = []
  const deleted: unknown[] = []
  const { api, handlers } = baseApi({
    route: { current: { name: "session", params: { sessionID: "ses_visible" } } },
    state: {
      config: {},
      path: { directory: "/proj" },
      session: {
        get: () => ({ directory: "/proj" }),
        messages: () => [{ role: "user", id: "m1" }],
      },
      part: () => [{ type: "text", text: "hello there" }],
    },
    client: {
      tool: {
        ids: async () => ({ data: ["bash", "sesh_list", "custom_mcp_tool"] }),
      },
      session: {
        create: async () => ({ data: { id: "ses_hidden", directory: "/proj" } }),
        prompt: async (request: { tools?: Record<string, boolean> }) => {
          prompted.push(request)
          return { data: { parts: [{ type: "text", text: "go ahead" }] } }
        },
        delete: async (request: unknown) => {
          deleted.push(request)
          return { data: true }
        },
        list: async () => ({ data: [] }),
      },
    },
  })

  let dispose!: () => void
  ;(api.lifecycle as { onDispose: (cb: () => void) => void }).onDispose = (cb) => {
    dispose = cb
  }

  try {
    await ghost.tui(api as any, { idleDelayMs: 0 }, {} as any)
    for (const handler of handlers["session.idle"] ?? []) handler({ properties: { sessionID: "ses_visible" } })
    await waitFor(() => deleted.length >= 1)
    expect(prompted).toHaveLength(1)
    const tools = prompted[0].tools ?? {}
    // Dynamically discovered (not in the static list):
    expect(tools.sesh_list).toBe(false)
    expect(tools.custom_mcp_tool).toBe(false)
    // Still covered by the static list too:
    expect(tools.bash).toBe(false)
  } finally {
    dispose?.()
  }
})
