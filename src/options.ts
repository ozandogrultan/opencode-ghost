export type PromptSuggestOptions = {
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
  "It must sound like the user, not the assistant: short and direct.",
  "Never restate or summarize the assistant's reply.",
  'If the assistant proposed a next step, a brief affirmation such as "Yes." or "Go ahead." is best.',
  "If the assistant asked a question, answer it briefly.",
  "Output one line, plain text only: no markdown, no quotes, no backticks, no preamble.",
  "If no reply makes sense, output exactly: NONE",
].join("\n")

const DEFAULTS = {
  enabled: true,
  acceptKeys: ["tab", "right"],
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
