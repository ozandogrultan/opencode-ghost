import { describe, expect, test } from "bun:test"
import { resolveOptions } from "../src/options"
import { fetchStatelessSuggestion, resolveApiKey } from "../src/stateless"

describe("resolveApiKey", () => {
  test("returns undefined for empty input", () => {
    expect(resolveApiKey(undefined)).toBeUndefined()
    expect(resolveApiKey("")).toBeUndefined()
  })

  test("returns direct key", () => {
    expect(resolveApiKey("sk-12345")).toBe("sk-12345")
  })

  test("resolves environment variables", () => {
    process.env.TEST_GHOST_KEY = "secret-env-val"
    expect(resolveApiKey("{env:TEST_GHOST_KEY}")).toBe("secret-env-val")
    delete process.env.TEST_GHOST_KEY
  })
})

describe("fetchStatelessSuggestion", () => {
  test("calls OpenAI-compatible endpoint with correct payload and returns text", async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl = ""
    let capturedBody: any = null
    let capturedHeaders: any = null

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedHeaders = init?.headers
      capturedBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "run the tests",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as any

    try {
      const opts = resolveOptions({
        endpoint: "https://my-gateway.example.com/v1",
        apiKey: "test-key-abc",
      })
      const modelRef = { providerID: "custom", modelID: "fast-model" }
      const res = await fetchStatelessSuggestion("User: hello\nAssistant: hi", opts, modelRef, {})

      expect(res).toBe("run the tests")
      expect(capturedUrl).toBe("https://my-gateway.example.com/v1/chat/completions")
      expect(capturedHeaders["Authorization"]).toBe("Bearer test-key-abc")
      expect(capturedBody.model).toBe("fast-model")
      expect(capturedBody.messages).toHaveLength(2)
      expect(capturedBody.messages[1].content).toBe("User: hello\nAssistant: hi")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("handles fetch errors gracefully without throwing", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error("network down")
    }) as any

    try {
      const opts = resolveOptions({ endpoint: "https://down.example.com" })
      const res = await fetchStatelessSuggestion("hi", opts, { providerID: "p", modelID: "m" }, {})
      expect(res).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
