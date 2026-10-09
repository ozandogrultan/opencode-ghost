import { describe, expect, test } from "bun:test"
import { clip, isEcho, normalize, parseModel } from "../src/text"

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

describe("isEcho", () => {
  test("flags an exact repeat of the last message", () => {
    expect(isEcho("done", "done")).toBe(true)
    expect(isEcho("Done.", "done")).toBe(true)
    expect(isEcho("  go ahead  ", "Go ahead")).toBe(true)
  })

  test("flags a repeat wrapped in a longer message", () => {
    expect(isEcho("ok, run the full test suite again", "run the full test suite again")).toBe(true)
  })

  test("allows a genuinely new reply", () => {
    expect(isEcho("yes, go ahead", "done")).toBe(false)
    expect(isEcho("thanks", "why is the pane flashing")).toBe(false)
    expect(isEcho("", "done")).toBe(false)
  })
})

describe("normalize identifiers", () => {
  test("keeps underscores and asterisks inside words and globs", () => {
    expect(normalize("rename user_id to userId in *.ts files", 100)).toBe("rename user_id to userId in *.ts files")
    expect(normalize("fix __init__.py", 100)).toBe("fix __init__.py")
    expect(normalize("`snake_case`", 100)).toBe("snake_case")
  })

  test("unwraps bold and the role prefix", () => {
    expect(normalize("**Run the tests** now", 100)).toBe("Run the tests now")
    expect(normalize("Next user message: go ahead", 100)).toBe("go ahead")
  })

  test("truncates on code points", () => {
    const out = normalize("😀".repeat(20), 5)
    expect([...out!]).toEqual([..."😀😀😀😀", "…"])
  })
})
