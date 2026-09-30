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

  test("resolves well-known base URL and provider key from providers state", async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl = ""
    let capturedHeaders: any = null

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedHeaders = init?.headers
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "stateless reply" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as any

    try {
      const opts = resolveOptions({})
      const modelRef = { providerID: "groq", modelID: "llama-3.1-8b-instant" }
      const providers = [{ id: "groq", key: "gsk-testkey123" }]
      const res = await fetchStatelessSuggestion("test transcript", opts, modelRef, {}, providers)

      expect(res).toBe("stateless reply")
      expect(capturedUrl).toBe("https://api.groq.com/openai/v1/chat/completions")
      expect(capturedHeaders["Authorization"]).toBe("Bearer gsk-testkey123")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("resolves Anthropic using provider key from state", async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl = ""
    let capturedHeaders: any = null
    let capturedBody: any = null

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedHeaders = init?.headers
      capturedBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          content: [{ text: "anthropic suggestion" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as any

    try {
      const opts = resolveOptions({})
      const modelRef = { providerID: "anthropic", modelID: "claude-haiku-4-5" }
      const providers = [{ id: "anthropic", key: "sk-ant-testkey" }]
      const res = await fetchStatelessSuggestion("test transcript", opts, modelRef, {}, providers)

      expect(res).toBe("anthropic suggestion")
      expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages")
      expect(capturedHeaders["x-api-key"]).toBe("sk-ant-testkey")
      expect(capturedBody.model).toBe("claude-haiku-4-5")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("preserves slashes in model IDs for OpenRouter", async () => {
    const originalFetch = globalThis.fetch
    let capturedBody: any = null

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "openrouter reply" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as any

    try {
      const opts = resolveOptions({})
      const modelRef = { providerID: "openrouter", modelID: "meta-llama/llama-3.1-8b-instruct" }
      const providers = [{ id: "openrouter", key: "sk-or-testkey" }]
      const res = await fetchStatelessSuggestion("test transcript", opts, modelRef, {}, providers)

      expect(res).toBe("openrouter reply")
      expect(capturedBody.model).toBe("meta-llama/llama-3.1-8b-instruct")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("handles Ollama without Authorization header when no key is set", async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl = ""
    let capturedHeaders: any = null

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedHeaders = init?.headers
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ollama reply" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as any

    try {
      const opts = resolveOptions({})
      const modelRef = { providerID: "ollama", modelID: "llama3.2:1b" }
      const res = await fetchStatelessSuggestion("test transcript", opts, modelRef, {}, [])

      expect(res).toBe("ollama reply")
      expect(capturedUrl).toBe("http://127.0.0.1:11434/v1/chat/completions")
      expect(capturedHeaders["Authorization"]).toBeUndefined()
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
