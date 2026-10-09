import { describe, expect, test } from "bun:test"
import { DEFAULT_SYSTEM, parseSuggestCommand, removedOptionKeys, resolveOptions } from "../src/options"

describe("resolveOptions", () => {
  test("booleans reject truthy and falsy nonboolean values", () => {
    for (const value of ["false", "true", 0, 1, null, [], {}]) {
      const opts = resolveOptions({ enabled: value })
      expect(opts.enabled).toBe(true)
    }
  })

  test("accept keys fall back when invalid and deduplicate canonical bindings", () => {
    expect(resolveOptions({ acceptKeys: [null, 1, "", " ", "ctrl+"] }).acceptKeys).toEqual(["tab", "right"])
    expect(resolveOptions({ acceptKeys: ["Tab", " tab ", "SHIFT+Tab", "shift+tab", null] }).acceptKeys).toEqual(["tab", "shift+tab"])
  })

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

describe("parseSuggestCommand", () => {
  test("parses toggle, model, debug and log verbs", () => {
    expect(parseSuggestCommand(undefined)).toEqual({ type: "toggle" })
    expect(parseSuggestCommand("   ")).toEqual({ type: "toggle" })
    expect(parseSuggestCommand("debug")).toEqual({ type: "debug", value: undefined })
    expect(parseSuggestCommand("debug on")).toEqual({ type: "debug", value: true })
    expect(parseSuggestCommand("debug off")).toEqual({ type: "debug", value: false })
    expect(parseSuggestCommand("log")).toEqual({ type: "log" })
    expect(parseSuggestCommand("model openai/gpt-5")).toEqual({ type: "model", model: "openai/gpt-5" })
    expect(parseSuggestCommand("model clear")).toEqual({ type: "model", model: undefined })
  })

  test("rejects unknown or malformed input", () => {
    for (const input of ["nope", "debug maybe", "debug on extra", "log now", "model", "model a"]) {
      expect(parseSuggestCommand(input)).toEqual({ type: "invalid" })
    }
  })
})

describe("removedOptionKeys", () => {
  test("returns nothing for current options", () => {
    expect(removedOptionKeys(undefined)).toEqual([])
    expect(removedOptionKeys({ model: "x/y", acceptKeys: ["tab"] })).toEqual([])
  })

  test("flags dropped transport and marker options", () => {
    expect(
      removedOptionKeys({
        endpoint: "https://example.com",
        apiKey: "sk-x",
        internalSessionMarkerDir: "/tmp/x",
        argHints: { foo: ["a"] },
        backOnEmptyLeft: false,
      }),
    ).toEqual(["endpoint", "apiKey", "internalSessionMarkerDir", "argHints", "backOnEmptyLeft"])
  })

  test("normalises accept key aliases and drops unknown modifiers", () => {
    expect(resolveOptions({ acceptKeys: ["meta+y", "Cmd+Y", "bogus+z", "esc"] }).acceptKeys).toEqual(["alt+y", "super+y", "escape"])
    expect(resolveOptions({ acceptKeys: ["bogus+z"] }).acceptKeys).toEqual(["tab", "right"])
  })
})
