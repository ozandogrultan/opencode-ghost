import { expect, test } from "bun:test"
import { acceptCommand, acceptCommandId, acceptShortcuts, ghostKeymapLayers } from "../src/keymap"
import { parseSuggestCommand } from "../src/options"

test("accept command returns false to the host for missing, mismatched or ineligible composers", () => {
  let route: string | undefined
  let suggestion: string | undefined = "current"
  let eligible = false
  const calls: string[] = []
  const command = acceptCommand("shift+tab", () => route, () => suggestion, (id) => { calls.push(id); return eligible })
  expect(command.run()).toBe(false)
  route = "other"
  expect(command.run()).toBe(false)
  route = "current"
  suggestion = undefined
  expect(command.run()).toBe(false)
  expect(calls).toEqual([])
  suggestion = "current"
  expect(command.run()).toBe(false)
  eligible = true
  expect(command.run()).toBeUndefined()
  expect(calls).toEqual(["current", "current"])
})

test("accept shortcuts follow rebound and unbound command bindings", () => {
  const bindings: Record<string, string[]> = { [acceptCommandId("tab")]: ["Ctrl+Y"], [acceptCommandId("right")]: [] }
  const keys = acceptShortcuts(["tab", "right"], (id) => bindings[id] ?? [])
  expect([...keys].sort()).toEqual(["ctrl+y"])
  bindings[acceptCommandId("tab")] = ["tab", "alt+enter"]
  expect([...acceptShortcuts(["tab", "right"], (id) => bindings[id] ?? [])].sort()).toEqual(["alt+enter", "tab"])
})

test("ghostKeymapLayers configures base mode for composer and global mode for suggest", async () => {
  const composerCommands = [
    { id: "ghost.accept.tab", bind: "tab", run: () => {} },
    { id: "ghost.accept.right", bind: "right", run: () => {} },
    { id: "ghost.home", bind: "left", run: () => {} },
  ]
  const received: ReturnType<typeof parseSuggestCommand>[] = []
  const layers = ghostKeymapLayers(composerCommands, true, async (input) => {
    received.push(parseSuggestCommand(input))
  })

  expect(layers).toHaveLength(2)

  const [composerLayer, suggestLayer] = layers
  expect(composerLayer.mode).toBe("base")
  expect(composerLayer.priority).toBe(2)
  expect(composerLayer.commands).toBe(composerCommands)

  expect(suggestLayer.mode).toBe("global")
  expect(suggestLayer.commands).toHaveLength(1)

  const suggestCommand = suggestLayer.commands![0]
  expect(suggestCommand.id).toBe("ghost.suggest")
  expect(suggestCommand.title).toBe("Prompt suggestions: on")
  expect(suggestCommand.palette).toBe(true)
  expect(suggestCommand.slash).toEqual({ name: "suggest", arguments: true })

  await suggestCommand.run("model openai/gpt-6-luna-fast")
  expect(received.at(-1)).toEqual({ type: "model", model: "openai/gpt-6-luna-fast" })

  await suggestCommand.run(undefined)
  expect(received.at(-1)).toEqual({ type: "toggle" })

  const disabledLayers = ghostKeymapLayers(composerCommands, false, () => {})
  expect(disabledLayers[1].commands![0].title).toBe("Prompt suggestions: off")
})
