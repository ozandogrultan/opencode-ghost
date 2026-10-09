import { describe, expect, test } from "bun:test"
import { buildTranscript, lastUserText, suggestionPrompt, type TranscriptMessage } from "../src/transcript"

describe("buildTranscript", () => {
  test("filters metadata, tools and empty text before taking the last N", () => {
    expect(buildTranscript([
      { type: "user", text: "older" },
      { type: "user", text: "recent" },
      { type: "assistant", content: [{ type: "text", text: "done" }] },
      { type: "assistant", content: [{ type: "tool" }] },
      { type: "user", text: " " },
      { type: "agent-selected" },
    ], 2)).toBe("User: recent\nAssistant: done\n\nTask: write the user's next message.")
  })

  test("includes the configured system in the generation prompt", () => {
    expect(suggestionPrompt("Custom instructions", buildTranscript([{ type: "user", text: "hi" }], 1))).toBe("Custom instructions\n\nUser: hi\n\nTask: write the user's next message.")
  })
  test("joins user and assistant text in order", () => {
    const messages: TranscriptMessage[] = [
      { type: "user", text: "run the tests" },
      { type: "assistant", content: [{ type: "text", text: "13 passed" }] },
    ]
    const transcript = buildTranscript(messages, 10)
    expect(transcript).toBe(
      "User: run the tests\nAssistant: 13 passed\n\nTask: write the user's next message.",
    )
  })

  test("skips non-text assistant content and other message kinds", () => {
    const messages: TranscriptMessage[] = [
      { type: "agent-selected" },
      { type: "user", text: "go" },
      { type: "assistant", content: [{ type: "tool" }, { type: "text", text: "done" }] },
    ]
    const transcript = buildTranscript(messages, 10)
    expect(transcript).toBe("User: go\nAssistant: done\n\nTask: write the user's next message.")
  })

  test("limits to the most recent messages", () => {
    const messages: TranscriptMessage[] = [
      { type: "user", text: "first" },
      { type: "user", text: "second" },
    ]
    expect(buildTranscript(messages, 1)).toContain("User: second")
    expect(buildTranscript(messages, 1)).not.toContain("first")
  })

  test("keeps the end of long assistant messages and the start of long user messages", () => {
    const long = `${"a".repeat(900)} Want me to proceed?`
    const transcript = buildTranscript([
      { type: "user", text: `start ${"b".repeat(900)}` },
      { type: "assistant", content: [{ type: "text", text: long }] },
    ], 10)
    const [user, assistant] = transcript.split("\n")
    expect(user!.startsWith("User: start b")).toBe(true)
    expect(user!.endsWith("…")).toBe(true)
    expect(assistant!.startsWith("Assistant: …")).toBe(true)
    expect(assistant!.endsWith("Want me to proceed?")).toBe(true)
    expect(assistant!.length).toBeLessThanOrEqual("Assistant: ".length + 800)
  })

  test("returns empty string when there is nothing to say", () => {
    expect(buildTranscript([], 10)).toBe("")
    expect(buildTranscript([{ type: "user", text: "   " }], 10)).toBe("")
  })
})

describe("lastUserText", () => {
  test("returns the most recent user message", () => {
    const messages: TranscriptMessage[] = [
      { type: "user", text: "first" },
      { type: "assistant", content: [{ type: "text", text: "ok" }] },
      { type: "user", text: "second" },
    ]
    expect(lastUserText(messages)).toBe("second")
  })

  test("returns an empty string with no user message", () => {
    expect(lastUserText([{ type: "assistant", content: [] }])).toBe("")
  })
})
