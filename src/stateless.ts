import type { SuggestionModel } from "./text"

export type GenerateClient = {
  generate: {
    text(
      input: { prompt: string; model: { id: string; providerID: string; variant?: string } },
      requestOptions?: { signal?: AbortSignal },
    ): Promise<{ text?: string }>
  }
}

export const MODEL_UNAVAILABLE_RETRY_MS: readonly number[] = [1000, 2000, 4000, 8000]

function isModelUnavailable(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === "string" && /^Model unavailable:/.test(message)
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done)
  })
}

export async function generateSuggestion(
  client: GenerateClient,
  prompt: string,
  model: SuggestionModel | undefined | Promise<SuggestionModel | undefined>,
  signal: AbortSignal,
  onError?: (error: unknown) => void,
  allowed: () => boolean = () => true,
  retryDelays: readonly number[] = MODEL_UNAVAILABLE_RETRY_MS,
): Promise<string | undefined> {
  try {
    const resolved = await model
    if (signal.aborted || !allowed() || !resolved) return undefined
    const input = { prompt, model: { id: resolved.modelID, providerID: resolved.providerID, ...(resolved.variant ? { variant: resolved.variant } : {}) } }
    for (let attempt = 0; ; attempt++) {
      try {
        return (await client.generate.text(input, { signal })).text
      } catch (error) {
        if (!isModelUnavailable(error) || attempt >= retryDelays.length) throw error
        await pause(retryDelays[attempt]!, signal)
        if (signal.aborted || !allowed()) return undefined
      }
    }
  } catch (error) {
    if (!signal.aborted) onError?.(error)
    return undefined
  }
}
