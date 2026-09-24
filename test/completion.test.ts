import { describe, expect, test } from "bun:test"
import { completeCommand, type CommandPool } from "../src/completion"

const pool: CommandPool[] = [
  { name: "keepwarm", description: "Keep the daemon warm" },
  { name: "keepalive", description: "Keep alive" },
  { name: "new", description: "New session" },
]

test("ghosts the remainder of a unique command name", () => {
  const result = completeCommand("/keepw", pool)
  expect(result?.ghost).toBe("arm")
  expect(result?.insert).toBe("/keepwarm ")
})

test("shows argument options after a complete command name", () => {
  const result = completeCommand("/keepwarm ", pool, { keepwarm: ["6h", "always", "off"] })
  expect(result?.args).toEqual(["6h", "always", "off"])
  expect(result?.ghost).toBe("6h")
  expect(result?.insert).toBe("/keepwarm 6h ")
})

test("filters argument options by the word in progress", () => {
  const result = completeCommand("/keepwarm a", pool, { keepwarm: ["6h", "always", "off"] })
  expect(result?.args).toEqual(["always"])
  expect(result?.insert).toBe("/keepwarm always ")
})

test("shows the description when there are no argument hints", () => {
  const result = completeCommand("/new ", pool)
  expect(result?.hint).toBe("New session")
  expect(result?.ghost).toBeUndefined()
})

test("returns nothing for an unknown command", () => {
  expect(completeCommand("/zzz", pool)).toBeUndefined()
})

test("returns nothing for plain text input", () => {
  expect(completeCommand("hello", pool)).toBeUndefined()
})

test("ghosts the first command when only a slash is typed", () => {
  const result = completeCommand("/", pool)
  expect(result?.ghost).toBe("keepwarm")
  expect(result?.insert).toBe("/keepwarm ")
})

test("prefix matching is case-insensitive on the command name", () => {
  const result = completeCommand("/NEW", pool)
  expect(result?.insert).toBe("/new ")
})
