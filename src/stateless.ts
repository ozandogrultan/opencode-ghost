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
  model: SuggestionModel | undefined,
  signal: AbortSignal,
  onError?: (error: unknown) => void,
): Promise<string | undefined> {
  if (signal.aborted || !model) return undefined
  try {
    const result = await client.generate.text(
      { prompt, model: { id: model.modelID, providerID: model.providerID, ...(model.variant ? { variant: model.variant } : {}) } },
      { signal },
    )
    return result.text
  } catch (error) {
    if (!signal.aborted) onError?.(error)
    return undefined
  }
}
