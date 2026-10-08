import { clip } from "./text"

const MAX_MESSAGE_CHARS = 800
const MAX_TRANSCRIPT_CHARS = 6000

export type TranscriptMessage =
  | { readonly type: "user"; readonly text: string }
  | { readonly type: "assistant"; readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }> }
  | { readonly type: string }

function messageText(message: TranscriptMessage): { role: "User" | "Assistant"; text: string } | undefined {
  if (message.type === "user" && "text" in message) return { role: "User", text: message.text }
  if (message.type === "assistant" && "content" in message) {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join(" ")
    return { role: "Assistant", text }
  }
  return undefined
}

export function buildTranscript(messages: readonly TranscriptMessage[], recentMessages: number): string {
  const lines: string[] = []
  const entries = messages.map(messageText).filter((entry) => entry && entry.text.trim())
  for (const entry of entries.slice(-recentMessages)) {
    if (!entry) continue
    lines.push(`${entry.role}: ${clip(entry.text, MAX_MESSAGE_CHARS)}`)
  }
  if (lines.length === 0) return ""
  return `${lines.join("\n").slice(-MAX_TRANSCRIPT_CHARS)}\n\nTask: write the user's next message.`
}

export function lastUserText(messages: readonly TranscriptMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.type === "user") return (message as { text: string }).text
  }
  return ""
}

export function suggestionPrompt(system: string, transcript: string): string {
  return `${system}\n\n${transcript}`
}
