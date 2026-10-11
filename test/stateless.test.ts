import { describe, expect, test } from "bun:test"
import { generateSuggestion, type GenerateClient } from "../src/stateless"

function fakeClient(impl: GenerateClient["generate"]["text"]): GenerateClient {
  return { generate: { text: impl } }
}

describe("generateSuggestion", () => {
  test("abort and route changes during model resolution prevent native generation", async () => {
    for (const reason of ["abort", "route", "unchanged"]) {
      const controller = new AbortController()
      let currentSession = "current"
      let requests = 0
      let resolve!: (model: { providerID: string; modelID: string }) => void
      const model = new Promise<{ providerID: string; modelID: string }>((done) => { resolve = done })
      const client = fakeClient(async () => { requests++; return { text: "next" } })
      const pending = generateSuggestion(client, "prompt", model, controller.signal, undefined, () => currentSession === "current")
      if (reason === "abort") controller.abort()
      if (reason === "route") currentSession = "other"
      resolve({ providerID: "a", modelID: "b" })
      expect(await pending).toBe(reason === "unchanged" ? "next" : undefined)
      expect(requests).toBe(reason === "unchanged" ? 1 : 0)
    }
  })

  test("reports failures but suppresses abort errors", async () => {
    const errors: unknown[] = []
    const client = fakeClient(async () => { throw new Error("unavailable") })
    const controller = new AbortController()
    await generateSuggestion(client, "prompt", { providerID: "a", modelID: "b" }, controller.signal, (error) => errors.push(error))
    controller.abort()
    await generateSuggestion(client, "prompt", { providerID: "a", modelID: "b" }, controller.signal, (error) => errors.push(error))
    expect(errors).toHaveLength(1)
  })
  test("passes prompt, converts the model ref, and forwards the abort signal", async () => {
    let captured: unknown
    let capturedOptions: unknown
    const client = fakeClient(async (input, options) => {
      captured = input
      capturedOptions = options
      return { text: "run the tests" }
    })
    const controller = new AbortController()

    const result = await generateSuggestion(
      client,
      "User: hi\nAssistant: hello",
      { providerID: "anthropic", modelID: "claude-haiku-4-5" },
      controller.signal,
    )

    expect(result).toBe("run the tests")
    expect(captured).toEqual({
      prompt: "User: hi\nAssistant: hello",
      model: { id: "claude-haiku-4-5", providerID: "anthropic" },
    })
    expect((capturedOptions as { signal?: AbortSignal })?.signal).toBe(controller.signal)
  })

  test("retries a transient model-unavailable error without reporting it", async () => {
    let calls = 0
    const errors: unknown[] = []
    const client = fakeClient(async () => {
      if (++calls < 3) throw Object.assign(new Error("Model unavailable: a/b"), { _tag: "InvalidRequestError" })
      return { text: "next" }
    })
    const result = await generateSuggestion(client, "p", { providerID: "a", modelID: "b" }, new AbortController().signal, (error) => errors.push(error), () => true, [1, 1, 1])
    expect(result).toBe("next")
    expect(calls).toBe(3)
    expect(errors).toHaveLength(0)
  })

  test("reports model-unavailable once retries are exhausted and never retries other errors", async () => {
    let calls = 0
    const errors: unknown[] = []
    const unavailable = fakeClient(async () => { calls++; throw new Error("Model unavailable: a/b") })
    await generateSuggestion(unavailable, "p", { providerID: "a", modelID: "b" }, new AbortController().signal, (error) => errors.push(error), () => true, [1, 1])
    expect(calls).toBe(3)
    expect(errors).toHaveLength(1)
    calls = 0
    const other = fakeClient(async () => { calls++; throw new Error("boom") })
    await generateSuggestion(other, "p", { providerID: "a", modelID: "b" }, new AbortController().signal, undefined, () => true, [1, 1])
    expect(calls).toBe(1)
  })

  test("abort or route change during the retry wait stops further attempts", async () => {
    for (const reason of ["abort", "route"]) {
      const controller = new AbortController()
      let current = true
      let calls = 0
      const client = fakeClient(async () => { calls++; throw new Error("Model unavailable: a/b") })
      const pending = generateSuggestion(client, "p", { providerID: "a", modelID: "b" }, controller.signal, undefined, () => current, [20, 20])
      await Bun.sleep(5)
      if (reason === "abort") controller.abort()
      else current = false
      expect(await pending).toBeUndefined()
      expect(calls).toBe(1)
    }
  })

  test("never calls native generation when no model is resolved", async () => {
    let captured: unknown
    const client = fakeClient(async (input) => {
      captured = input
      return { text: "ok" }
    })

    await generateSuggestion(client, "transcript", undefined, new AbortController().signal)

    expect(captured).toBeUndefined()
  })

  test("returns undefined when the server returns no text", async () => {
    const client = fakeClient(async () => ({}))
    const result = await generateSuggestion(client, "transcript", { providerID: "a", modelID: "b" }, new AbortController().signal)
    expect(result).toBeUndefined()
  })

  test("swallows errors and returns undefined", async () => {
    const client = fakeClient(async () => {
      throw new Error("model unavailable")
    })
    const result = await generateSuggestion(client, "transcript", { providerID: "a", modelID: "b" }, new AbortController().signal)
    expect(result).toBeUndefined()
  })

  test("preserves an explicit variant", async () => {
    let captured: unknown
    const client = fakeClient(async (input) => { captured = input; return {} })
    await generateSuggestion(client, "prompt", { providerID: "a", modelID: "b", variant: "minimal" }, new AbortController().signal)
    expect(captured).toEqual({ prompt: "prompt", model: { providerID: "a", id: "b", variant: "minimal" } })
  })
})
