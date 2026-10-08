import type { SuggestionModel } from "./text"

export type GenerateClient = {
  generate: {
    text(
      input: { prompt: string; model: { id: string; providerID: string; variant?: string } },
      requestOptions?: { signal?: AbortSignal },
    ): Promise<{ text?: string }>
  }
}

export async function generateSuggestion(
  client: GenerateClient,
  prompt: string,
  model: SuggestionModel | undefined | Promise<SuggestionModel | undefined>,
  signal: AbortSignal,
  onError?: (error: unknown) => void,
  allowed: () => boolean = () => true,
): Promise<string | undefined> {
  try {
    const resolved = await model
    if (signal.aborted || !allowed() || !resolved) return undefined
    const result = await client.generate.text(
      { prompt, model: { id: resolved.modelID, providerID: resolved.providerID, ...(resolved.variant ? { variant: resolved.variant } : {}) } },
      { signal },
    )
    return result.text
  } catch (error) {
    if (!signal.aborted) onError?.(error)
    return undefined
  }
}
