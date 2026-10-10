import { expect, spyOn, test } from "bun:test"
import { InternalKeyHandler, ScrollBoxRenderable, TextRenderable } from "@opentui/core"
import { testRender, type JSX } from "@opentui/solid"
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

function makeContext(width: number, height: number) {
  const [routeSignal, setRouteSignal] = createSignal<Route>({ type: "session", sessionID: "session-a" })
  const [muted, setMuted] = createSignal({ r: 0.5, g: 0.5, b: 0.5, a: 1 })
  let themeReads = 0
  const listeners = new Map<string, Set<(event: any) => void>>()
  const alerts: { title: string; message: string }[] = []
  let dialogRender: (() => JSX.Element) | undefined
  let dialogView: Awaited<ReturnType<typeof testRender>> | undefined
  let dialogOptions: { size?: string; centered?: boolean } = {}
  const toasts: { message: string; variant?: string }[] = []
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
    theme: { text: { get muted() { themeReads++; return muted() } } },
    storage: {
      store: (_key: string, { initial }: { initial: object }) => {
        const [store, setStore] = createStore(initial)
        return [store, async (mutation: (draft: typeof initial) => void) => setStore(produce(mutation))] as const
      },
    },
    ui: {
      toast: { show: (input: { message: string; variant?: string }) => { toasts.push(input) } },
      dialog: {
        alert: async (input: { title: string; message: string }) => { alerts.push(input) },
        set: (options: typeof dialogOptions) => { dialogOptions = options },
        show: (render: () => JSX.Element) => { dialogRender = render },
        clear: () => { dialogView?.renderer.destroy(); dialogView = undefined },
      },
      router: { current: () => routeSignal() },
      slot: (claim: unknown) => { slotClaims.push(claim); return () => { slotUnregistered++ } },
    },
  }

  return {
    context: context as unknown as Context,
    setRoute: setRouteSignal,
    emit: (type: string, event: unknown) => { for (const handler of [...(listeners.get(type) ?? [])]) handler(event) },
    lastAlert: () => alerts.at(-1),
    dispatchSuggest: async (input?: string) => {
      await commands.get("ghost.suggest")!.run(input)
      if (!dialogRender) return
      const render = dialogRender
      dialogRender = undefined
      dialogView?.renderer.destroy()
      dialogView = await testRender(() => (
        <box width="100%" height="100%" alignItems="center" justifyContent="center">
          <box width="90%" maxWidth={80}>{render()}</box>
        </box>
      ), { width, height })
      await dialogView.renderOnce()
      const body = dialogView.renderer.root.findDescendantById("ghost-diagnostics-body")
      if (body instanceof TextRenderable) alerts.push({ title: "Ghost — diagnostics", message: body.plainText })
    },
    dialog: { get view() { return dialogView }, get options() { return dialogOptions } },
    closeDialog: () => context.ui.dialog.clear(),
    clientState,
    messages: context.data.session.message,
    toasts,
    setMuted,
    themeReads: () => themeReads,
    frame: { get callback() { return frameCallback }, get removed() { return frameCallbackRemoved } },
    slots: { claims: slotClaims, get unregistered() { return slotUnregistered } },
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
  }
}

function boot(width = 100, height = 40) {
  const harness = makeContext(width, height)
  let cleanup: (() => void) | undefined
  let disposeRoot!: () => void
  createRoot((dispose) => {
    disposeRoot = dispose
    const result = plugin.setup(harness.context)
    cleanup = typeof result === "function" ? result : undefined
  })
  return { ...harness, unloadPlugin: () => cleanup?.(), unload: () => { harness.closeDialog(); cleanup?.(); disposeRoot() } }
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

test("aborting during sync, model resolution or generation logs cancellation and leaves no suggestion", async () => {
  for (const stage of ["sync", "sync-error", "resolution", "resolution-error", "generation"] as const) {
    const harness = boot()
    try {
      const gate = deferred<void>()
      if (stage === "sync" || stage === "sync-error") harness.messages.sync = async () => { await gate.promise; if (stage === "sync-error") throw new Error("cancelled sync") }
      else if (stage === "resolution" || stage === "resolution-error") harness.clientState.modelList = async () => { await gate.promise; if (stage === "resolution-error") throw new Error("cancelled resolution"); return { data: [stubModel] } }
      else harness.clientState.generateText = async () => { await gate.promise; return { text: "run the new test suite" } }
      harness.emit("session.execution.succeeded", { id: `evt-${stage}`, data: { sessionID: "session-a" } })
      await tick(30)
      harness.emit("session.execution.started", { data: { sessionID: "session-a" } })
      gate.resolve()
      await tick(30)
      await harness.dispatchSuggest("log")
      expect(harness.lastAlert()?.message).toContain("suggestion none")
      expect(harness.lastAlert()?.message).toContain("aborted")
      expect(harness.lastAlert()?.message).toMatch(/sync \d+ms/)
      if (stage.startsWith("resolution") || stage === "generation") expect(harness.lastAlert()?.message).toMatch(/model \d+ms/)
      if (stage === "generation") expect(harness.lastAlert()?.message).toMatch(/generation \d+ms/)
      expect(harness.toasts).toHaveLength(0)
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

test("plugin unload disposes the theme memo without disposing its host owner", () => {
  const harness = boot()
  try {
    harness.setMuted({ r: 0.4, g: 0.4, b: 0.4, a: 1 })
    harness.unloadPlugin()
    const reads = harness.themeReads()
    harness.setMuted({ r: 0.3, g: 0.3, b: 0.3, a: 1 })
    expect(harness.themeReads()).toBe(reads)
  } finally {
    harness.unload()
  }
})

test("sync failures warn separately without consuming the model warning", async () => {
  const harness = boot()
  try {
    harness.messages.sync = async () => { throw new Error("offline") }
    for (const id of ["sync-1", "sync-2"]) {
      harness.emit("session.execution.succeeded", { id, data: { sessionID: "session-a" } })
      await tick(30)
    }
    expect(harness.toasts).toHaveLength(1)
    expect(harness.toasts[0]?.message).toContain("sync")
    expect(harness.toasts[0]?.message).not.toContain("/suggest model")
    await harness.dispatchSuggest("log")
    expect(harness.lastAlert()?.message).toContain("offline")
    expect(harness.lastAlert()?.message).toMatch(/sync \d+ms/)
    harness.messages.sync = async () => {}
    harness.clientState.generateText = async () => { throw new Error("unsupported model") }
    harness.emit("session.execution.succeeded", { id: "model-1", data: { sessionID: "session-a" } })
    await tick(30)
    expect(harness.toasts).toHaveLength(2)
    expect(harness.toasts[1]?.message).toContain("/suggest model")
    await harness.dispatchSuggest("log")
    expect(harness.lastAlert()?.message).toMatch(/generation \d+ms/)
  } finally {
    harness.unload()
  }
})

test("generation logs separate stage durations and sends the configured soft budget", async () => {
  let clock = 1000
  const now = spyOn(Date, "now").mockImplementation(() => clock)
  const harness = boot()
  let prompt = ""
  try {
    harness.messages.sync = async () => { clock += 11 }
    harness.clientState.modelList = async () => { clock += 22; return { data: [stubModel] } }
    harness.context.client.generate.text = async (input) => { prompt = input.prompt; clock += 33; return { text: "run the new test suite" } }
    harness.emit("session.execution.succeeded", { id: "timed", data: { sessionID: "session-a" } })
    await tick(30)
    await harness.dispatchSuggest("log")
    expect(harness.lastAlert()?.message).toContain("ok stub/suggest 66ms")
    expect(harness.lastAlert()?.message).toContain("sync 11ms, model 22ms, generation 33ms")
    expect(prompt).toContain("at most 120 characters")
  } finally {
    harness.unload()
    now.mockRestore()
  }
})

test("diagnostics use a centered bounded dialog with focused keyboard scrolling and resize support", async () => {
  const harness = boot(80, 24)
  try {
    for (let i = 0; i < 20; i++) {
      harness.emit("session.execution.succeeded", { id: `log-${i}`, data: { sessionID: "session-a" } })
      await tick(10)
    }
    await harness.dispatchSuggest("log")
    expect(harness.dialog.options).toEqual({ size: "large", centered: true })
    const view = harness.dialog.view!
    expect(view).toBeDefined()
    const modal = view.renderer.root.findDescendantById("ghost-diagnostics")!
    const scroll = view.renderer.root.findDescendantById("ghost-diagnostics-scroll") as ScrollBoxRenderable
    expect(scroll).toBeInstanceOf(ScrollBoxRenderable)
    expect(scroll.focused).toBe(true)
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.height)
    expect(modal.y).toBeGreaterThan(0)
    expect(modal.y + modal.height).toBeLessThan(24)
    expect(Math.abs(modal.y - (24 - modal.height) / 2)).toBeLessThanOrEqual(1)
    const before = scroll.scrollTop
    await view.mockInput.pressKeys(["\u001b[6~"])
    await view.renderOnce()
    expect(scroll.scrollTop).toBeGreaterThan(before)
    expect(view.captureCharFrame()).toContain("Ghost — diagnostics")
    const afterKeyboard = scroll.scrollTop
    await view.mockMouse.scroll(scroll.x + 1, scroll.y + 1, "down")
    await view.renderOnce()
    expect(scroll.scrollTop).toBeGreaterThan(afterKeyboard)
    view.resize(40, 12)
    await view.renderOnce()
    expect(scroll.height).toBeLessThanOrEqual(4)
    expect(modal.x).toBeGreaterThanOrEqual(0)
    expect(modal.x + modal.width).toBeLessThanOrEqual(40)
    expect(modal.y).toBeGreaterThanOrEqual(0)
    expect(modal.y + modal.height).toBeLessThanOrEqual(12)
    expect(view.captureCharFrame()).toContain("Ghost — diagnostics")
  } finally {
    harness.unload()
  }
})
