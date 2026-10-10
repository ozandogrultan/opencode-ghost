import { expect, test } from "bun:test"
import { InternalKeyHandler } from "@opentui/core"
import { createRoot, createSignal } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Context } from "@opencode/plugin/tui/context"
import plugin from "../src/tui"

type Route = { type: "home" } | { type: "session"; sessionID: string } | { type: "plugin"; id: string; name: string }

const stubModel = { providerID: "stub", id: "suggest", variants: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const tick = (ms = 20) => new Promise<void>((done) => setTimeout(done, ms))

function makeClient() {
  const state = {
    modelList: async (): Promise<{ data: unknown[] }> => ({ data: [stubModel] }),
    modelDefault: async (): Promise<{ data: unknown }> => ({ data: stubModel }),
    agentList: async (): Promise<{ data: unknown[] }> => ({ data: [] }),
    generateText: async (): Promise<{ text?: string }> => ({ text: "run the new test suite" }),
  }
  const client = {
    generate: { text: (...args: unknown[]) => state.generateText(...(args as [])) },
    model: {
      list: (...args: unknown[]) => state.modelList(...(args as [])),
      default: (...args: unknown[]) => state.modelDefault(...(args as [])),
    },
    agent: { list: (...args: unknown[]) => state.agentList(...(args as [])) },
  }
  return { client, state }
}

function makeContext() {
  const [routeSignal, setRouteSignal] = createSignal<Route>({ type: "session", sessionID: "session-a" })
  const listeners = new Map<string, Set<(event: any) => void>>()
  const alerts: { title: string; message: string }[] = []
  const commands = new Map<string, { run: (input?: string) => unknown }>()
  const sessions = new Map<string, { status: "idle" | "running"; messages: { type: string; text: string }[] }>([
    ["session-a", { status: "idle", messages: [{ type: "user", text: "please add a test" }] }],
    ["session-b", { status: "idle", messages: [{ type: "user", text: "please add a test" }] }],
  ])
  const location = { directory: "/project" }
  let frameCallback: ((delta: number) => Promise<void>) | undefined
  let frameCallbackRemoved = false
  const slotClaims: unknown[] = []
  let slotUnregistered = 0
  const { client, state: clientState } = makeClient()

  const context = {
    options: { model: "stub/suggest", idleDelayMs: 5 },
    location,
    client,
    data: {
      on(type: string, handler: (event: any) => void) {
        const set = listeners.get(type) ?? new Set()
        set.add(handler)
        listeners.set(type, set)
        return () => set.delete(handler)
      },
      session: {
        status: (sessionID: string) => sessions.get(sessionID)?.status ?? "idle",
        get: () => undefined,
        message: {
          sync: async () => {},
          list: (sessionID: string) => sessions.get(sessionID)?.messages ?? [],
        },
      },
      location: { default: () => location },
    },
    keymap: {
      layer: (factory: () => { commands?: { id?: string; run: (input?: string) => unknown }[] }) => {
        for (const command of factory().commands ?? []) if (command.id) commands.set(command.id, command)
      },
      mode: { current: () => "base" },
      shortcuts: () => [],
    },
    renderer: {
      keyInput: new InternalKeyHandler(),
      hasSelection: false,
      currentFocusedEditor: undefined,
      setFrameCallback: (callback: (delta: number) => Promise<void>) => { frameCallback = callback },
      removeFrameCallback: (callback: (delta: number) => Promise<void>) => { if (callback === frameCallback) frameCallbackRemoved = true },
    },
    theme: { text: { muted: { r: 0.5, g: 0.5, b: 0.5, a: 1 } } },
    storage: {
      store: (_key: string, { initial }: { initial: object }) => {
        const [store, setStore] = createStore(initial)
        return [store, async (mutation: (draft: typeof initial) => void) => setStore(produce(mutation))] as const
      },
    },
    ui: {
      toast: { show: () => {} },
      dialog: { alert: async (input: { title: string; message: string }) => { alerts.push(input) } },
      router: { current: () => routeSignal() },
      slot: (claim: unknown) => { slotClaims.push(claim); return () => { slotUnregistered++ } },
    },
  }

  return {
    context: context as unknown as Context,
    setRoute: setRouteSignal,
    emit: (type: string, event: unknown) => { for (const handler of [...(listeners.get(type) ?? [])]) handler(event) },
    lastAlert: () => alerts.at(-1),
    dispatchSuggest: async (input?: string) => { await commands.get("ghost.suggest")!.run(input) },
    clientState,
    frame: { get callback() { return frameCallback }, get removed() { return frameCallbackRemoved } },
    slots: { claims: slotClaims, get unregistered() { return slotUnregistered } },
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
  }
}

function boot() {
  const harness = makeContext()
  let cleanup: (() => void) | undefined
  let disposeRoot!: () => void
  createRoot((dispose) => {
    disposeRoot = dispose
    const result = plugin.setup(harness.context)
    cleanup = typeof result === "function" ? result : undefined
  })
  return { ...harness, unload: () => { cleanup?.(); disposeRoot() } }
}

test("a succeeded turn produces a suggestion via the stubbed generation client", async () => {
  const harness = boot()
  try {
    harness.emit("session.execution.succeeded", { id: "evt-1", data: { sessionID: "session-a" } })
    await tick(40)
    await harness.dispatchSuggest("log")
    expect(harness.lastAlert()?.message).toContain("suggestion retained")
  } finally {
    harness.unload()
  }
})

test("aborting mid model-resolution or mid generation leaves no suggestion", async () => {
  for (const stage of ["resolution", "generation"] as const) {
    const harness = boot()
    try {
      const gate = deferred<void>()
      if (stage === "resolution") harness.clientState.modelList = async () => { await gate.promise; return { data: [stubModel] } }
      else harness.clientState.generateText = async () => { await gate.promise; return { text: "run the new test suite" } }
      harness.emit("session.execution.succeeded", { id: `evt-${stage}`, data: { sessionID: "session-a" } })
      await tick(30)
      harness.emit("session.execution.started", { data: { sessionID: "session-a" } })
      gate.resolve()
      await tick(30)
      await harness.dispatchSuggest("log")
      expect(harness.lastAlert()?.message).toContain("suggestion none")
    } finally {
      harness.unload()
    }
  }
})

test("execution start cancels a pending generation for the current session but not for another session", async () => {
  for (const [startedSessionID, expectSuggestion] of [["session-a", false], ["session-b", true]] as const) {
    const harness = boot()
    try {
      const gate = deferred<void>()
      harness.clientState.generateText = async () => { await gate.promise; return { text: "run the new test suite" } }
      harness.emit("session.execution.succeeded", { id: `evt-${startedSessionID}`, data: { sessionID: "session-a" } })
      await tick(30)
      harness.emit("session.execution.started", { data: { sessionID: startedSessionID } })
      gate.resolve()
      await tick(30)
      await harness.dispatchSuggest("log")
      expect(harness.lastAlert()?.message).toContain(expectSuggestion ? "suggestion retained" : "suggestion none")
    } finally {
      harness.unload()
    }
  }
})

test("switching the active session clears a retained suggestion", async () => {
  const harness = boot()
  try {
    harness.emit("session.execution.succeeded", { id: "evt-1", data: { sessionID: "session-a" } })
    await tick(30)
    await harness.dispatchSuggest("log")
    expect(harness.lastAlert()?.message).toContain("suggestion retained")
    harness.setRoute({ type: "session", sessionID: "session-b" })
    await tick(1)
    await harness.dispatchSuggest("log")
    expect(harness.lastAlert()?.message).toContain("suggestion none")
  } finally {
    harness.unload()
  }
})

test("/suggest toggle disables and clears the suggestion, then re-enabling generates again", async () => {
  const harness = boot()
  try {
    harness.emit("session.execution.succeeded", { id: "evt-1", data: { sessionID: "session-a" } })
    await tick(30)
    await harness.dispatchSuggest("log")
    expect(harness.lastAlert()?.message).toContain("suggestion retained")

    await harness.dispatchSuggest(undefined)
    await harness.dispatchSuggest("log")
    expect(harness.lastAlert()?.message).toContain("suggestion none")

    await harness.dispatchSuggest(undefined)
    await tick(30)
    await harness.dispatchSuggest("log")
    expect(harness.lastAlert()?.message).toContain("suggestion retained")
  } finally {
    harness.unload()
  }
})

test("/suggest model override clears a retained suggestion", async () => {
  const harness = boot()
  try {
    harness.emit("session.execution.succeeded", { id: "evt-1", data: { sessionID: "session-a" } })
    await tick(30)
    await harness.dispatchSuggest("log")
    expect(harness.lastAlert()?.message).toContain("suggestion retained")

    await harness.dispatchSuggest("model other/model")
    await harness.dispatchSuggest("log")
    expect(harness.lastAlert()?.message).toContain("suggestion none")
  } finally {
    harness.unload()
  }
})

test("unload removes event listeners, the frame callback and the composer slot", () => {
  const harness = boot()
  expect(harness.listenerCount("session.execution.succeeded")).toBe(1)
  expect(harness.listenerCount("session.execution.started")).toBe(1)
  expect(harness.frame.callback).toBeDefined()
  expect(harness.slots.claims).toHaveLength(1)
  harness.unload()
  expect(harness.listenerCount("session.execution.succeeded")).toBe(0)
  expect(harness.listenerCount("session.execution.started")).toBe(0)
  expect(harness.frame.removed).toBe(true)
  expect(harness.slots.unregistered).toBe(1)
})
