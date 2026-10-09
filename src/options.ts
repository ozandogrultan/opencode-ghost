import { parseModel } from "./text"
import { canonicalKey } from "./composer"

export type GhostOptions = {
  enabled?: boolean
  model?: string
  acceptKeys?: string[]
  maxChars?: number
  idleDelayMs?: number
  recentMessages?: number
  system?: string
}

export type ResolvedOptions = {
  enabled: boolean
  model: string | undefined
  acceptKeys: string[]
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
  "- Copy the tone, language and length of the user's earlier messages in the transcript: short, direct, one line, plain text only.",
  '- If the assistant proposed a single next step or asked for approval, a brief affirmation such as "Yes." or "Go ahead." is best.',
  "- If the assistant offered options or recommended one, pick the recommended option, or the first one if none is recommended.",
  "- If the assistant asked a question the transcript answers, answer it briefly.",
  "- If the work is finished and verified, ask for the natural follow-up (commit, open the PR, or run the remaining checks) only when the user has asked for that earlier in the transcript.",
  "- No markdown, no quotes, no backticks, no preamble.",
  "",
  "Examples:",
  "Assistant: I ran the tests - 13 passed, 0 failed.",
  "Next user message: great, thanks",
  "Assistant: That changes the hook contract. Want me to proceed?",
  "Next user message: yes, go ahead",
  "Assistant: Which model should the small tasks use?",
  "Next user message: the fast free one",
  "Assistant: I see two approaches. A (recommended) patches the parser; B rewrites the loader.",
  "Next user message: go with A",
  "Assistant: The fix is in and verified. Anything else?",
  "Next user message: NONE",
  "",
  "Output exactly NONE when no reply is clearly right: the assistant only reported status with nothing pending, or the answer needs information only the user has.",
].join("\n")

const DEFAULTS = {
  enabled: true,
  acceptKeys: ["tab", "right"],
  maxChars: 120,
  idleDelayMs: 500,
  recentMessages: 10,
}

const REMOVED_OPTION_KEYS = ["endpoint", "apiKey", "internalSessionMarkerDir", "argHints", "backOnEmptyLeft"] as const

export function removedOptionKeys(raw: Readonly<Record<string, unknown>> | undefined): string[] {
  if (!raw) return []
  return REMOVED_OPTION_KEYS.filter((key) => key in raw)
}

export function resolveOptions(options: Readonly<Record<string, unknown>> | undefined): ResolvedOptions {
  const input = (options ?? {}) as GhostOptions
  const maxChars = input.maxChars
  const idleDelayMs = input.idleDelayMs
  const recentMessages = input.recentMessages
  const acceptKeys = Array.isArray(input.acceptKeys)
    ? [...new Set(input.acceptKeys.filter((key) => typeof key === "string" && key.trim() && key.trim().split("+").every((part) => part.trim())).map(canonicalKey))]
    : []
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULTS.enabled,
    model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : undefined,
    acceptKeys: acceptKeys.length > 0 ? acceptKeys : [...DEFAULTS.acceptKeys],
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

export type SuggestCommand =
  | { type: "toggle" }
  | { type: "model"; model: string | undefined }
  | { type: "debug"; value: boolean | undefined }
  | { type: "log" }
  | { type: "invalid" }

export function parseSuggestCommand(input: string | undefined): SuggestCommand {
  const raw = input?.trim() ?? ""
  if (!raw) return { type: "toggle" }
  if (raw === "log") return { type: "log" }
  if (raw === "debug") return { type: "debug", value: undefined }
  const debug = /^debug\s+(on|off)$/.exec(raw)
  if (debug) return { type: "debug", value: debug[1] === "on" }
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
