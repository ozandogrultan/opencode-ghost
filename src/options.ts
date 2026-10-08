import { parseModel } from "./text"
import { canonicalKey } from "./composer"

export type GhostOptions = {
  enabled?: boolean
  model?: string
  acceptKeys?: string[]
  backOnEmptyLeft?: boolean
  maxChars?: number
  idleDelayMs?: number
  recentMessages?: number
  system?: string
}

export type ResolvedOptions = {
  enabled: boolean
  model: string | undefined
  acceptKeys: string[]
  backOnEmptyLeft: boolean
  maxChars: number
  idleDelayMs: number
  recentMessages: number
  system: string
}

export const DEFAULT_SYSTEM = [
  "You write the next message that the USER of a coding agent would send.",
  "Write what the user says AFTER the assistant's latest reply.",
  "",
  "Rules:",
  "- Move the conversation forward. Never repeat, quote, or paraphrase the user's own previous message.",
  "- Sound like the user: short and direct, one line, plain text only.",
  '- If the assistant proposed a next step, a brief affirmation such as "Yes." or "Go ahead." is best.',
  "- If the assistant asked a question, answer it briefly.",
  "- No markdown, no quotes, no backticks, no preamble.",
  "",
  "Examples:",
  "Assistant: I ran the tests - 13 passed, 0 failed.",
  "Next user message: great, thanks",
  "Assistant: That changes the hook contract. Want me to proceed?",
  "Next user message: yes, go ahead",
  "Assistant: Which model should the small tasks use?",
  "Next user message: the fast free one",
  "",
  "If no reply makes sense, output exactly: NONE",
].join("\n")

const DEFAULTS = {
  enabled: true,
  acceptKeys: ["tab", "right"],
  backOnEmptyLeft: true,
  maxChars: 120,
  idleDelayMs: 500,
  recentMessages: 10,
}

const REMOVED_OPTION_KEYS = ["endpoint", "apiKey", "internalSessionMarkerDir", "argHints"] as const

export function removedOptionKeys(raw: Readonly<Record<string, unknown>> | undefined): string[] {
  if (!raw) return []
  return REMOVED_OPTION_KEYS.filter((key) => key in raw)
}

export function resolveOptions(options: Readonly<Record<string, unknown>> | undefined): ResolvedOptions {
  const input = (options ?? {}) as GhostOptions
  const maxChars = input.maxChars
  const idleDelayMs = input.idleDelayMs
  const recentMessages = input.recentMessages
  return {
    enabled: input.enabled ?? DEFAULTS.enabled,
    model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : undefined,
    acceptKeys:
      Array.isArray(input.acceptKeys) && input.acceptKeys.length > 0
        ? input.acceptKeys.filter((key) => typeof key === "string" && key.trim()).map(canonicalKey)
        : [...DEFAULTS.acceptKeys],
    backOnEmptyLeft: input.backOnEmptyLeft ?? DEFAULTS.backOnEmptyLeft,
    maxChars: typeof maxChars === "number" && maxChars > 0 ? maxChars : DEFAULTS.maxChars,
    idleDelayMs:
      typeof idleDelayMs === "number" && idleDelayMs >= 0 ? idleDelayMs : DEFAULTS.idleDelayMs,
    recentMessages:
      typeof recentMessages === "number" && recentMessages > 0
        ? recentMessages
        : DEFAULTS.recentMessages,
    system: typeof input.system === "string" && input.system.trim() ? input.system : DEFAULT_SYSTEM,
  }
}

export function parseSuggestCommand(input: string | undefined): { type: "toggle" } | { type: "model"; model: string | undefined } | { type: "invalid" } {
  const raw = input?.trim() ?? ""
  if (!raw) return { type: "toggle" }
  const match = /^model\s+(\S+)$/.exec(raw)
  if (!match || (match[1] !== "clear" && !parseModel(match[1]))) return { type: "invalid" }
  return { type: "model", model: match[1] === "clear" ? undefined : match[1] }
}

export function suggestionModel(runtime: string | undefined, configured: string | undefined) {
  const spec = runtime ?? configured
  if (spec === undefined) return undefined
  const model = parseModel(spec)
  if (!model) throw new Error("Invalid suggestion model; set /suggest model provider/model")
  return model
}
