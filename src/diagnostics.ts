export type DiagnosticOutcome = "ok" | "empty" | "echo" | "unavailable" | "error" | "aborted"

export type DiagnosticEntry = {
  readonly at: number
  readonly sessionID: string
  readonly outcome: DiagnosticOutcome
  readonly model?: string
  readonly durationMs?: number
  readonly chars?: number
  readonly detail?: string
}

export const DIAGNOSTIC_HISTORY_LIMIT = 20

export type Diagnostics = {
  record(entry: Omit<DiagnosticEntry, "at">): DiagnosticEntry
  list(): readonly DiagnosticEntry[]
}

export function createDiagnostics(limit = DIAGNOSTIC_HISTORY_LIMIT, now: () => number = Date.now): Diagnostics {
  const entries: DiagnosticEntry[] = []
  return {
    record(input) {
      const entry: DiagnosticEntry = { ...input, at: now() }
      entries.push(entry)
      if (entries.length > limit) entries.splice(0, entries.length - limit)
      return entry
    },
    list() {
      return [...entries].reverse()
    },
  }
}

export function modelLabel(model: { providerID: string; modelID: string; variant?: string }): string {
  return `${model.providerID}/${model.modelID}${model.variant ? `@${model.variant}` : ""}`
}

export function errorDetail(error: unknown): string {
  const text = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : error === undefined || error === null
        ? ""
        : String(error)
  return text.replace(/\s+/g, " ").trim() || "unknown error"
}

const OUTCOME_LABELS: Record<DiagnosticOutcome, string> = {
  ok: "ok",
  empty: "empty",
  echo: "echo",
  unavailable: "no model",
  error: "error",
  aborted: "aborted",
}

function clockTime(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatDiagnostic(entry: DiagnosticEntry): string {
  const parts = [clockTime(entry.at), OUTCOME_LABELS[entry.outcome], entry.model ?? "—"]
  if (entry.durationMs !== undefined) parts.push(`${entry.durationMs}ms`)
  if (entry.chars !== undefined) parts.push(`${entry.chars} chars`)
  const line = parts.join(" ")
  return entry.detail ? `${line}\n  ${entry.detail}` : line
}

export function formatDiagnostics(entries: readonly DiagnosticEntry[]): string {
  if (entries.length === 0) return "No generation attempts recorded yet."
  return entries.map(formatDiagnostic).join("\n")
}
