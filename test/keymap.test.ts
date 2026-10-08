import { expect, test } from "bun:test"
import { createTestKeymap } from "@opentui/keymap/testing"
import { ghostKeymapLayers } from "../src/keymap"
import { parseSuggestCommand } from "../src/options"

test("suggest stays reachable in palette and autocomplete while composer keys remain base-only", () => {
  const { keymap, host, cleanup } = createTestKeymap({ defaultKeys: true })
  let accepted = 0
  let navigated = 0
  let input: string | undefined
  const commands: ReturnType<typeof parseSuggestCommand>[] = []
  const layers = ghostKeymapLayers([
    ...["tab", "right"].map((key) => ({
      id: `ghost.accept.${key}`,
      bind: key,
      run: () => { accepted++ },
    })),
    { id: "ghost.home", bind: "left", run: () => { navigated++ } },
  ], true, (value) => { commands.push(parseSuggestCommand(value)) })
  try {
    keymap.registerLayerFields({ mode: (value, context) => context.require("opencode.mode", value) })
    for (const layer of layers) {
      keymap.registerLayer({
        ...(layer.mode === "global" ? {} : { mode: layer.mode }),
        priority: layer.priority,
        commands: layer.commands!.map((command) => ({
          name: command.id!,
          title: command.title,
          run: () => command.run(input),
        })),
        bindings: layer.commands!.flatMap((command) => typeof command.bind === "string"
          ? [{ key: command.bind, cmd: command.id! }]
          : []),
      })
    }
    for (const mode of ["base", "modal", "autocomplete"]) {
      keymap.setData("opencode.mode", mode)
      const reachable = keymap.getCommandEntries({ visibility: "reachable" })
      const suggest = reachable.find((entry) => entry.command.name === "ghost.suggest")
      expect(suggest?.command.title).toBe("Prompt suggestions: on")
      const definition = layers.flatMap((layer) => layer.commands!).find((command) => command.id === suggest?.command.name)!
      expect(definition.palette).toBe(true)
      expect(definition.slash).toEqual({ name: "suggest", arguments: true })
      expect(reachable.some((entry) => entry.command.name === "ghost.accept.tab")).toBe(mode === "base")
      expect(reachable.some((entry) => entry.command.name === "ghost.accept.right")).toBe(mode === "base")
      expect(reachable.some((entry) => entry.command.name === "ghost.home")).toBe(mode === "base")
      input = "model openai/gpt-5"
      keymap.dispatchCommand("ghost.suggest")
      expect(commands.at(-1)).toEqual({ type: "model", model: "openai/gpt-5" })
      input = undefined
      keymap.dispatchCommand("ghost.suggest")
      expect(commands.at(-1)).toEqual({ type: "toggle" })
      const previousAccepted = accepted
      const previousNavigated = navigated
      host.press("tab")
      host.press("right")
      host.press("left")
      expect(accepted - previousAccepted).toBe(mode === "base" ? 2 : 0)
      expect(navigated - previousNavigated).toBe(mode === "base" ? 1 : 0)
    }
  } finally {
    cleanup()
  }
})
