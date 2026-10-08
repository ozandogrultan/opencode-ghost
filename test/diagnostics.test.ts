import { describe, expect, test } from "bun:test"
import {
  createDiagnostics,
  DIAGNOSTIC_HISTORY_LIMIT,
  errorDetail,
  formatDiagnostic,
  formatDiagnostics,
  modelLabel,
} from "../src/diagnostics"

describe("createDiagnostics", () => {
  test("records a timestamp and lists newest first", () => {
    let clock = 1000
    const diagnostics = createDiagnostics(3, () => (clock += 100))
    diagnostics.record({ sessionID: "s", outcome: "ok" })
    diagnostics.record({ sessionID: "s", outcome: "empty" })
    expect(diagnostics.list().map((entry) => entry.outcome)).toEqual(["empty", "ok"])
    expect(diagnostics.list()[0]!.at).toBe(1200)
  })

  test("keeps only the most recent entries", () => {
    const diagnostics = createDiagnostics(2, () => 0)
    diagnostics.record({ sessionID: "s", outcome: "ok" })
    diagnostics.record({ sessionID: "s", outcome: "echo" })
    diagnostics.record({ sessionID: "s", outcome: "error" })
    expect(diagnostics.list().map((entry) => entry.outcome)).toEqual(["error", "echo"])
  })

  test("defaults to the shared history limit", () => {
    const diagnostics = createDiagnostics(undefined, () => 0)
    for (let index = 0; index < DIAGNOSTIC_HISTORY_LIMIT + 5; index++) {
      diagnostics.record({ sessionID: "s", outcome: "ok" })
    }
    expect(diagnostics.list()).toHaveLength(DIAGNOSTIC_HISTORY_LIMIT)
  })
})

describe("modelLabel", () => {
  test("renders provider, model and optional variant", () => {
    expect(modelLabel({ providerID: "a", modelID: "b" })).toBe("a/b")
    expect(modelLabel({ providerID: "a", modelID: "b", variant: "low" })).toBe("a/b@low")
  })
})

describe("errorDetail", () => {
  test("collapses whitespace and falls back when empty", () => {
    expect(errorDetail(new Error("line one\n  line two"))).toBe("line one line two")
    expect(errorDetail("boom")).toBe("boom")
    expect(errorDetail(undefined)).toBe("unknown error")
    expect(errorDetail("   ")).toBe("unknown error")
  })
})

describe("formatDiagnostic", () => {
  test("renders a readable line with optional detail", () => {
    expect(formatDiagnostic({ at: 0, sessionID: "s", outcome: "ok", model: "a/b", durationMs: 12, chars: 5 }))
      .toContain("ok a/b 12ms 5 chars")
    const failed = formatDiagnostic({ at: 0, sessionID: "s", outcome: "error", detail: "429 slow down" })
    expect(failed).toContain("error —")
    expect(failed.endsWith("\n  429 slow down")).toBe(true)
  })
})

describe("formatDiagnostics", () => {
  test("handles empty and populated histories", () => {
    expect(formatDiagnostics([])).toBe("No generation attempts recorded yet.")
    expect(formatDiagnostics([{ at: 0, sessionID: "s", outcome: "echo" }])).toContain("echo")
  })
})
