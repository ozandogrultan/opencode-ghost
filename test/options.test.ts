import { describe, expect, test } from "bun:test"
import { DEFAULT_SYSTEM, resolveOptions } from "../src/options"

describe("resolveOptions", () => {
  test("applies defaults", () => {
    const opts = resolveOptions(undefined)
    expect(opts.enabled).toBe(true)
    expect(opts.acceptKeys).toEqual(["tab", "right"])
    expect(opts.maxChars).toBe(120)
    expect(opts.idleDelayMs).toBe(500)
    expect(opts.recentMessages).toBe(10)
    expect(opts.system).toBe(DEFAULT_SYSTEM)
    expect(opts.model).toBeUndefined()
  })

  test("honors overrides", () => {
    const opts = resolveOptions({
      enabled: false,
      model: "openai/gpt-5",
      acceptKeys: ["tab"],
      maxChars: 40,
      idleDelayMs: 0,
      recentMessages: 3,
      system: "hi",
    })
    expect(opts.enabled).toBe(false)
    expect(opts.model).toBe("openai/gpt-5")
    expect(opts.acceptKeys).toEqual(["tab"])
    expect(opts.maxChars).toBe(40)
    expect(opts.idleDelayMs).toBe(0)
    expect(opts.recentMessages).toBe(3)
    expect(opts.system).toBe("hi")
  })

  test("rejects invalid values", () => {
    const opts = resolveOptions({
      acceptKeys: [],
      maxChars: -1,
      idleDelayMs: -5,
      recentMessages: 0,
      model: "   ",
    })
    expect(opts.acceptKeys).toEqual(["tab", "right"])
    expect(opts.maxChars).toBe(120)
    expect(opts.idleDelayMs).toBe(500)
    expect(opts.recentMessages).toBe(10)
    expect(opts.model).toBeUndefined()
  })
})
