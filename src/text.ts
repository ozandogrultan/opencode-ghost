import type { LocationRef, ModelInfo, OpenCodeClient } from "@opencode/client"

export type SuggestionModel = { providerID: string; modelID: string; variant?: string }

export const NO_SMALL_MODEL = "No default small model available; set /suggest model provider/model"

export function isNoSmallModel(error: unknown): boolean {
  return error instanceof Error && error.message === NO_SMALL_MODEL
}

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

export type Catalog = {
  list(location: LocationRef, signal: AbortSignal, fresh?: boolean): Promise<{ models: readonly ModelInfo[]; cached: boolean }>
  clear(): void
}

export const CATALOG_TTL_MS = 5 * 60_000

export function createCatalog(
  client: Pick<SmallModelClient, "model">,
  ttlMs: number = CATALOG_TTL_MS,
  now: () => number = Date.now,
): Catalog {
  const entries = new Map<string, { at: number; models: readonly ModelInfo[] }>()
  return {
    async list(location, signal, fresh = false) {
      const key = JSON.stringify(location)
      const hit = entries.get(key)
      if (hit && !fresh && now() - hit.at < ttlMs) return { models: hit.models, cached: true }
      const result = await client.model.list({ location }, { signal })
      entries.set(key, { at: now(), models: result.data })
      return { models: result.data, cached: false }
    },
    clear: () => entries.clear(),
  }
}

function directCatalog(client: Pick<SmallModelClient, "model">): Catalog {
  return {
    async list(location, signal) {
      return { models: (await client.model.list({ location }, { signal })).data, cached: false }
    },
    clear() {},
  }
}

export async function resolveSmallModel(
  client: SmallModelClient,
  location: LocationRef,
  signal: AbortSignal,
  session?: { model?: { providerID: string }; agent?: string },
  catalog: Catalog = directCatalog(client),
): Promise<SuggestionModel | undefined> {
  const attempt = async (fresh: boolean) => {
    let cached = false
    try {
      return { model: await resolveFromCatalog(client, location, signal, session, async (...args) => {
        const listed = await catalog.list(args[0], args[1], fresh)
        cached = listed.cached
        return listed.models
      }) }
    } catch (error) {
      if (cached && isNoSmallModel(error) && !signal.aborted) return undefined
      throw error
    }
  }
  const first = await attempt(false)
  return first ? first.model : (await attempt(true))?.model
}

async function resolveFromCatalog(
  client: SmallModelClient,
  location: LocationRef,
  signal: AbortSignal,
  session: { model?: { providerID: string }; agent?: string } | undefined,
  models: (location: LocationRef, signal: AbortSignal) => Promise<readonly ModelInfo[]>,
): Promise<SuggestionModel | undefined> {
  if (signal.aborted) return undefined
  const agents = await client.agent.list({ location }, { signal })
  if (signal.aborted) return undefined
  const configured = agents.data.find((agent) => agent.id === "title")?.model
  let providerID = session?.model?.providerID ?? (session?.agent ? agents.data.find((agent) => agent.id === session.agent)?.model?.providerID : undefined)
  if (configured?.variant) return { providerID: configured.providerID, modelID: configured.id, variant: configured.variant }
  if (!configured && !providerID) {
    const primary = await client.model.default({ location }, { signal })
    if (signal.aborted) return undefined
    providerID = primary.data?.providerID
  }
  const catalog = await models(location, signal)
  if (signal.aborted) return undefined
  if (configured) {
    const info = catalog.find((model) => model.providerID === configured.providerID && model.id === configured.id)
    return withLowEffortVariant({ providerID: configured.providerID, modelID: configured.id }, info)
  }
  providerID ??= catalog.find((model) => model.enabled && isTextModel(model))?.providerID
  if (!providerID) throw new Error(NO_SMALL_MODEL)
  const model = selectSmallModel(catalog, providerID)
  if (!model) throw new Error(NO_SMALL_MODEL)
  return withLowEffortVariant(model, catalog.find((info) => info.providerID === model.providerID && info.id === model.modelID))
}

export async function resolveExplicitModel(
  client: Pick<SmallModelClient, "model">,
  location: LocationRef,
  signal: AbortSignal,
  model: SuggestionModel,
  catalog: Catalog = directCatalog(client),
): Promise<SuggestionModel | undefined> {
  if (signal.aborted) return undefined
  if (model.variant) return model
  const listed = await catalog.list(location, signal)
  if (signal.aborted) return undefined
  return withLowEffortVariant(model, listed.models.find((info) => info.providerID === model.providerID && info.id === model.modelID))
}

const LOW_EFFORT_VARIANTS = ["none", "minimal", "low"]

function withLowEffortVariant(model: SuggestionModel, info: ModelInfo | undefined): SuggestionModel {
  const variant = LOW_EFFORT_VARIANTS.find((id) => info?.variants.some((item) => item.id === id))
  return variant ? { ...model, variant } : model
}

function isTextModel(model: ModelInfo) {
  const text = (items: readonly string[]) => items.length === 0 || items.some((item) => item.startsWith("text"))
  return text(model.capabilities.input) && text(model.capabilities.output)
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

export function clipTail(text: string, max: number): string {
  const value = collapse(text)
  if (value.length <= max) return value
  return "…" + value.slice(value.length - (max - 1)).trimStart()
}

export function normalize(raw: string, maxChars: number): string | undefined {
  const first = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!first) return undefined
  const cleaned = first
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^[`"'*\-_#\s]+/, "")
    .replace(/[`"'*_#\s]+$/, "")
    .replace(/`+/g, "")
    .replace(/^next user message:\s*/i, "")
    .trim()
  if (!cleaned || /^none\.?$/i.test(cleaned)) return undefined
  const points = [...cleaned]
  if (points.length <= maxChars) return cleaned
  return points.slice(0, maxChars - 1).join("").trimEnd() + "…"
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
