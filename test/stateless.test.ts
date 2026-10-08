import { describe, expect, test } from "bun:test"
import { generateSuggestion, type GenerateClient } from "../src/stateless"

function fakeClient(impl: GenerateClient["generate"]["text"]): GenerateClient {
  return { generate: { text: impl } }
}

describe("generateSuggestion", () => {
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
