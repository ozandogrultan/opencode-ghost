import { describe, expect, test } from "bun:test"
import { clip, normalize, parseModel } from "../src/text"

describe("parseModel", () => {
  test("parses provider/model", () => {
    expect(parseModel("anthropic/claude-haiku-4-5")).toEqual({
      providerID: "anthropic",
      modelID: "claude-haiku-4-5",
    })
  })

  test("keeps slashes inside the model id", () => {
    expect(parseModel("a/b/c")).toEqual({ providerID: "a", modelID: "b/c" })
  })

  test("rejects malformed specs", () => {
    expect(parseModel(undefined)).toBeUndefined()
    expect(parseModel("")).toBeUndefined()
    expect(parseModel("x")).toBeUndefined()
    expect(parseModel("/x")).toBeUndefined()
    expect(parseModel("x/")).toBeUndefined()
  })
})

describe("clip", () => {
  test("collapses whitespace", () => {
    expect(clip("a\n  b\tc", 100)).toBe("a b c")
  })

  test("adds an ellipsis when over budget", () => {
    const out = clip("a".repeat(50), 10)
    expect(out.length).toBe(10)
    expect(out.endsWith("…")).toBe(true)
  })
})

describe("normalize", () => {
  test("takes the first non-empty line", () => {
    expect(normalize("\n  Yes, go ahead.\nmore", 100)).toBe("Yes, go ahead.")
  })

  test("strips wrapping quotes and backticks", () => {
    expect(normalize('"Run the tests"', 100)).toBe("Run the tests")
    expect(normalize("`go on`", 100)).toBe("go on")
  })

  test("rejects the no-suggestion token", () => {
    expect(normalize("NONE", 100)).toBeUndefined()
    expect(normalize("none.", 100)).toBeUndefined()
  })

  test("rejects empty output", () => {
    expect(normalize("   \n  ", 100)).toBeUndefined()
  })

  test("truncates to maxChars", () => {
    const out = normalize("a".repeat(200), 10)
    expect(out?.length).toBe(10)
    expect(out?.endsWith("…")).toBe(true)
  })
})
