export type PromptSuggestOptions = {
  enabled?: boolean
  model?: string
  acceptKeys?: string[]
  backOnEmptyLeft?: boolean
  internalSessionMarkerDir?: string
  maxChars?: number
  idleDelayMs?: number
  recentMessages?: number
  system?: string
  argHints?: Record<string, string[]>
}

export type ResolvedOptions = {
  enabled: boolean
  model: string | undefined
  acceptKeys: string[]
  backOnEmptyLeft: boolean
  internalSessionMarkerDir: string | undefined
  maxChars: number
  idleDelayMs: number
  recentMessages: number
  system: string
  argHints: Record<string, readonly string[]>
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

export function resolveOptions(options: PromptSuggestOptions | undefined): ResolvedOptions {
  const input = options ?? {}
  const maxChars = input.maxChars
  const idleDelayMs = input.idleDelayMs
  const recentMessages = input.recentMessages
  return {
    enabled: input.enabled ?? DEFAULTS.enabled,
    model: typeof input.model === "string" && input.model.trim() ? input.model.trim() : undefined,
    acceptKeys:
      Array.isArray(input.acceptKeys) && input.acceptKeys.length > 0
        ? input.acceptKeys
        : [...DEFAULTS.acceptKeys],
    backOnEmptyLeft: input.backOnEmptyLeft ?? DEFAULTS.backOnEmptyLeft,
    internalSessionMarkerDir:
      typeof input.internalSessionMarkerDir === "string" && input.internalSessionMarkerDir.trim()
        ? input.internalSessionMarkerDir.trim()
        : undefined,
    maxChars: typeof maxChars === "number" && maxChars > 0 ? maxChars : DEFAULTS.maxChars,
    idleDelayMs:
      typeof idleDelayMs === "number" && idleDelayMs >= 0 ? idleDelayMs : DEFAULTS.idleDelayMs,
    recentMessages:
      typeof recentMessages === "number" && recentMessages > 0
        ? recentMessages
        : DEFAULTS.recentMessages,
    system: typeof input.system === "string" && input.system.trim() ? input.system : DEFAULT_SYSTEM,
    argHints:
      input.argHints && typeof input.argHints === "object" && !Array.isArray(input.argHints)
        ? Object.fromEntries(
            Object.entries(input.argHints)
              .filter(([, value]) => Array.isArray(value) && value.length > 0)
              .map(([key, value]) => [key.toLowerCase(), [...value]]),
          )
        : {},
  }
}
