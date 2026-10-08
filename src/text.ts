import type { LocationRef, ModelInfo, OpenCodeClient } from "@opencode/client"

export type SuggestionModel = { providerID: string; modelID: string; variant?: string }

export const NO_SMALL_MODEL = "No default small model available; set /suggest model provider/model"

export type SmallModelClient = {
  agent: Pick<OpenCodeClient["agent"], "list">
  model: Pick<OpenCodeClient["model"], "default" | "list">
}

export function selectSmallModel(models: readonly ModelInfo[], providerID: string): SuggestionModel | undefined {
  const available = models.filter((model) => model.providerID === providerID && model.enabled &&
    model.status === "active" && model.capabilities.input.some((item) => item.startsWith("text")) &&
    model.capabilities.output.some((item) => item.startsWith("text")))
  for (const family of ["gpt-luna", "gemini-flash-lite", "gemini-flash", "claude-haiku"]) {
    const model = available.find((model) => model.family === family)
    if (model) return { providerID: model.providerID, modelID: model.id }
  }
  return undefined
}

export async function resolveSmallModel(
  client: SmallModelClient,
  location: LocationRef,
  signal: AbortSignal,
  providerID?: string,
): Promise<SuggestionModel | undefined> {
  if (signal.aborted) return undefined
  const agents = await client.agent.list({ location }, { signal })
  if (signal.aborted) return undefined
  const configured = agents.data.find((agent) => agent.id === "title")?.model
  if (configured) return { providerID: configured.providerID, modelID: configured.id, ...(configured.variant ? { variant: configured.variant } : {}) }
  if (!providerID) {
    const primary = await client.model.default({ location }, { signal })
    if (signal.aborted) return undefined
    providerID = primary.data?.providerID
  }
  if (!providerID) throw new Error(NO_SMALL_MODEL)
  const catalog = await client.model.list({ location }, { signal })
  if (signal.aborted) return undefined
  const model = selectSmallModel(catalog.data, providerID)
  if (!model) throw new Error(NO_SMALL_MODEL)
  return model
}

export function parseModel(spec: string | undefined): { providerID: string; modelID: string } | undefined {
  if (!spec || /\s/.test(spec)) return undefined
  const index = spec.indexOf("/")
  if (index <= 0 || index === spec.length - 1) return undefined
  return { providerID: spec.slice(0, index), modelID: spec.slice(index + 1) }
}

export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function clip(text: string, max: number): string {
  const value = collapse(text)
  if (value.length <= max) return value
  return value.slice(0, max - 1).trimEnd() + "…"
}

export function normalize(raw: string, maxChars: number): string | undefined {
  const first = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!first) return undefined
  const cleaned = first
    .replace(/^[`"'*\-_#\s]+/, "")
    .replace(/[`"'*_#\s]+$/, "")
    .replace(/[*`_]+/g, "")
    .trim()
  if (!cleaned || /^none\.?$/i.test(cleaned)) return undefined
  if (cleaned.length <= maxChars) return cleaned
  return cleaned.slice(0, maxChars - 1).trimEnd() + "…"
}

export function isEcho(suggestion: string, previous: string): boolean {
  const strip = (value: string) =>
    value
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/[.!?,;:]+$/, "")
  const next = strip(suggestion)
  const last = strip(previous)
  if (!next || !last) return false
  if (next === last) return true
  if (next.length >= 12 && last.includes(next)) return true
  if (last.length >= 12 && next.includes(last)) return true
  return false
}
