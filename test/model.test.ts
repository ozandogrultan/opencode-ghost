import { expect, test } from "bun:test"
import { parseSuggestCommand, suggestionModel } from "../src/options"
import type { AgentInfo, ModelInfo } from "@opencode/client"
import { NO_SMALL_MODEL, resolveExplicitModel, resolveSmallModel, selectSmallModel, type SmallModelClient } from "../src/text"
import { generateSuggestion } from "../src/stateless"
import { createLifecycle } from "../src/lifecycle"

test("slash arguments are raw argument text, not a full slash command", () => {
  expect(parseSuggestCommand(undefined)).toEqual({ type: "toggle" })
  expect(parseSuggestCommand("  ")).toEqual({ type: "toggle" })
  expect(parseSuggestCommand("model openai/gpt-6-luna-fast")).toEqual({ type: "model", model: "openai/gpt-6-luna-fast" })
  expect(parseSuggestCommand("model\topenai/gpt-6-luna-fast ")).toEqual({ type: "model", model: "openai/gpt-6-luna-fast" })
  expect(parseSuggestCommand("model clear")).toEqual({ type: "model", model: undefined })
  for (const raw of ["/suggest model openai/model", "model", "model invalid", "model openai/model extra"]) expect(parseSuggestCommand(raw)).toEqual({ type: "invalid" })
})

test("runtime model override survives serialization and clear falls back to options or small resolution", () => {
  let state: { enabled: boolean; model?: string } = { enabled: true }
  const command = parseSuggestCommand("model openai/gpt-6-luna-fast")
  if (command.type !== "model") throw new Error()
  state.model = command.model
  state = JSON.parse(JSON.stringify(state))
  expect(suggestionModel(state.model, "google-vertex/configured")).toEqual({ providerID: "openai", modelID: "gpt-6-luna-fast" })
  const clear = parseSuggestCommand("model clear")
  if (clear.type !== "model") throw new Error()
  state.model = clear.model
  state = JSON.parse(JSON.stringify(state))
  expect(suggestionModel(state.model, "google-vertex/configured")).toEqual({ providerID: "google-vertex", modelID: "configured" })
  expect(suggestionModel(state.model, undefined)).toBeUndefined()
})

const location = { directory: "/project" }
const signal = () => new AbortController().signal
const title = (overrides: Partial<AgentInfo> = {}): AgentInfo =>
  ({ id: "title", name: "Title", mode: "primary", hidden: true, request: { headers: {}, body: {} }, permissions: [], ...overrides })
const model = (overrides: Partial<ModelInfo> = {}): ModelInfo => ({
  id: "actual-small-id", modelID: "upstream-id", providerID: "primary", family: "gpt-luna", name: "small",
  capabilities: { tools: false, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 },
  cost: [], status: "active", enabled: true, limit: { context: 100, output: 10 }, ...overrides,
})

function client(agents: AgentInfo[] = [], models: ModelInfo[] = [model()]) {
  const calls: string[] = []
  const api: SmallModelClient = {
    agent: { list: async (input, options) => { expect(input).toEqual({ location }); expect(options?.signal).toBeDefined(); calls.push("agents"); return { location, data: agents } } },
    model: {
      default: async (input, options) => { expect(input).toEqual({ location }); expect(options?.signal).toBeDefined(); calls.push("default"); return { location, data: model({ id: "main", family: "main" }) } },
      list: async (input, options) => { expect(input).toEqual({ location }); expect(options?.signal).toBeDefined(); calls.push("list"); return { location, data: models } },
    },
  }
  return { api, calls }
}

test("effective hidden title model retains provider, catalog ID and variant", async () => {
  const { api, calls } = client([title({ model: { providerID: "vertex", id: "flash", variant: "minimal" } })])
  expect(await resolveSmallModel(api, location, signal())).toEqual({ providerID: "vertex", modelID: "flash", variant: "minimal" })
  expect(calls).toEqual(["agents"])
})

test("server-resolved directory title override is used without parsing configuration", async () => {
  const { api, calls } = client([title({ model: { providerID: "directory", id: "override" } })])
  expect(await resolveSmallModel(api, location, signal())).toEqual({ providerID: "directory", modelID: "override" })
  expect(calls).toEqual(["agents", "list"])
})

test("invalid explicit references warn rather than falling through to another model", () => {
  expect(() => suggestionModel("invalid", "valid/model")).toThrow("Invalid suggestion model")
  expect(() => suggestionModel(undefined, "invalid")).toThrow("Invalid suggestion model")
})

test("runtime and option overrides bypass agents and catalog; clearing resolves small default", async () => {
  const { api, calls } = client([title({ model: { providerID: "configured", id: "small" } })])
  const resolve = async (runtime?: string, option?: string) => suggestionModel(runtime, option) ?? await resolveSmallModel(api, location, signal())
  expect(await resolve("runtime/model", "option/model")).toEqual({ providerID: "runtime", modelID: "model" })
  expect(await resolve(undefined, "option/model")).toEqual({ providerID: "option", modelID: "model" })
  expect(calls).toEqual([])
  expect(await resolve()).toEqual({ providerID: "configured", modelID: "small" })
  expect(calls).toEqual(["agents", "list"])
})

test("family preference uses actual catalog IDs and keeps catalog order within a family", () => {
  const models = [model({ family: "claude-haiku", id: "haiku" }), model({ family: "gemini-flash", id: "flash" }),
    model({ family: "gemini-flash-lite", id: "lite" }), model({ id: "luna-first" }), model({ id: "luna-second" })]
  expect(selectSmallModel(models, "primary")?.modelID).toBe("luna-first")
  expect(selectSmallModel(models.slice(0, 3), "primary")?.modelID).toBe("lite")
  expect(selectSmallModel(models.slice(0, 2), "primary")?.modelID).toBe("flash")
  expect(selectSmallModel(models.slice(0, 1), "primary")?.modelID).toBe("haiku")
})

test("small selection excludes disabled, inactive, nontext and other-provider models", () => {
  const invalid = [model({ enabled: false }), model({ status: "beta" }), model({ status: "deprecated" }),
    model({ capabilities: { tools: false, input: ["image"], output: ["text"] } }),
    model({ capabilities: { tools: false, input: ["text"], output: ["image"] } }), model({ providerID: "other" })]
  expect(selectSmallModel(invalid, "primary")).toBeUndefined()
  expect(selectSmallModel([...invalid, model({ id: "valid", capabilities: { tools: false, input: ["text/plain"], output: ["text/plain"] } })], "primary")?.modelID).toBe("valid")
})

test("default provider is only a provider anchor, never a fallback generation model", async () => {
  const { api, calls } = client()
  expect(await resolveSmallModel(api, location, signal())).toEqual({ providerID: "primary", modelID: "actual-small-id" })
  expect(calls).toEqual(["agents", "default", "list"])
  const missing = client([], [model({ id: "main", family: "main" }), model({ providerID: "other" })])
  await expect(resolveSmallModel(missing.api, location, signal())).rejects.toThrow(NO_SMALL_MODEL)
})

test("small and variantless title models use the first supported low-effort variant", async () => {
  const variants = (...ids: string[]) => ids.map((id) => ({ id }))
  const small = client([], [model({ variants: variants("high", "low", "minimal") })])
  expect(await resolveSmallModel(small.api, location, signal())).toEqual({ providerID: "primary", modelID: "actual-small-id", variant: "minimal" })
  const titled = client([title({ model: { providerID: "vertex", id: "flash" } })], [model({ providerID: "vertex", id: "flash", variants: variants("none") })])
  expect(await resolveSmallModel(titled.api, location, signal())).toEqual({ providerID: "vertex", modelID: "flash", variant: "none" })
  const unsupported = client([], [model({ variants: variants("high") })])
  expect(await resolveSmallModel(unsupported.api, location, signal())).toEqual({ providerID: "primary", modelID: "actual-small-id" })
})

test("explicit overrides gain a supported low-effort variant without reselecting the model", async () => {
  const { api, calls } = client([], [model({ providerID: "google-vertex", id: "gemini-3.8-flash", family: "gemini-flash", variants: [{ id: "low" }, { id: "high" }] })])
  expect(await resolveExplicitModel(api, location, signal(), { providerID: "google-vertex", modelID: "gemini-3.8-flash" })).toEqual({ providerID: "google-vertex", modelID: "gemini-3.8-flash", variant: "low" })
  expect(await resolveExplicitModel(api, location, signal(), { providerID: "other", modelID: "unknown" })).toEqual({ providerID: "other", modelID: "unknown" })
  expect(calls).toEqual(["list", "list"])
})

test("missing default model anchors on the first enabled text model provider", async () => {
  const { api, calls } = client([], [model({ providerID: "off", enabled: false }), model({ providerID: "image", family: "main", capabilities: { tools: false, input: ["image"], output: ["image"] } }), model({ providerID: "first", family: "main" }), model({ providerID: "first", id: "small" })])
  api.model.default = async () => { calls.push("default"); return { location, data: null } }
  expect(await resolveSmallModel(api, location, signal())).toEqual({ providerID: "first", modelID: "small" })
  expect(calls).toEqual(["agents", "default", "list"])
})

test("missing, builtin and recreated model-less title use small selector within session provider", async () => {
  for (const agents of [[], [title()], [title({ hidden: false, description: "Recreated" })]]) {
    const { api, calls } = client(agents, [model({ providerID: "session" })])
    expect(await resolveSmallModel(api, location, signal(), "session")).toEqual({ providerID: "session", modelID: "actual-small-id" })
    expect(calls).toEqual(["agents", "list"])
  }
})

test("resolution reads changing effective agents and catalog on each generation", async () => {
  const agents: AgentInfo[] = []
  const models = [model()]
  const { api } = client(agents, models)
  expect((await resolveSmallModel(api, location, signal()))?.modelID).toBe("actual-small-id")
  models[0] = model({ id: "new-small" })
  expect((await resolveSmallModel(api, location, signal()))?.modelID).toBe("new-small")
  agents.push(title({ model: { providerID: "other", id: "configured" } }))
  expect((await resolveSmallModel(api, location, signal()))?.providerID).toBe("other")
  agents.splice(0)
  expect((await resolveSmallModel(api, location, signal()))?.modelID).toBe("new-small")
  agents.push(title({ description: "Recreated" }))
  expect((await resolveSmallModel(api, location, signal()))?.modelID).toBe("new-small")
})

test("cancellation at each async resolution boundary suppresses further work", async () => {
  for (const stage of ["before", "agents", "default", "list"]) {
    const controller = new AbortController()
    const { api, calls } = client()
    if (stage === "before") controller.abort()
    if (stage === "agents") {
      const original = api.agent.list
      api.agent.list = async (...args) => { const result = await original(...args); controller.abort(); return result }
    }
    for (const name of ["default", "list"] as const) {
      if (stage === name) {
        const original = api.model[name]
        if (name === "default") api.model.default = async (...args) => { await original(...args); controller.abort(); return { location, data: model() } }
        else api.model.list = async (...args) => { await original(...args); controller.abort(); return { location, data: [model()] } }
      }
    }
    expect(await resolveSmallModel(api, location, controller.signal)).toBeUndefined()
    expect(calls).toEqual(stage === "before" ? [] : stage === "agents" ? ["agents"] : stage === "default" ? ["agents", "default"] : ["agents", "default", "list"])
  }
})

test("no small model warns once and never reaches native generation", async () => {
  const { api } = client([], [model({ family: "main" })])
  let requests = 0
  const warnings: string[] = []
  const lifecycle = createLifecycle(0, () => true, async (_id, current) => {
    try {
      const selected = await resolveSmallModel(api, location, current)
      await generateSuggestion({ generate: { text: async () => { requests++; return {} } } }, "prompt", selected, current)
    } catch (error) {
      lifecycle.warn(() => warnings.push((error as Error).message))
    }
  }, () => {})
  await lifecycle.run("session")
  await lifecycle.run("session")
  expect(warnings).toEqual([NO_SMALL_MODEL])
  expect(requests).toBe(0)
  lifecycle.dispose()
})

test("provider generation failure warns without retrying or switching provider", async () => {
  const { api, calls } = client([title({ model: { providerID: "anthropic", id: "haiku" } })])
  const selected = await resolveSmallModel(api, location, signal())
  const requests: unknown[] = []
  const warnings: unknown[] = []
  await generateSuggestion({ generate: { text: async (input) => { requests.push(input); throw new Error("OAuth unsupported") } } }, "prompt", selected, signal(), (error) => warnings.push(error))
  expect(calls).toEqual(["agents", "list"])
  expect(requests).toEqual([{ prompt: "prompt", model: { providerID: "anthropic", id: "haiku" } }])
  expect(warnings).toHaveLength(1)
})
