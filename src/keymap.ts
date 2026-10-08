import type { KeymapCommand, KeymapLayer } from "@opencode/plugin/tui/context"
import { canonicalKey } from "./composer"

export const acceptCommandId = (key: string) => `ghost.accept.${key}`

export function acceptShortcuts(acceptKeys: readonly string[], shortcuts: (id: string) => readonly string[]): Set<string> {
  return new Set(acceptKeys.flatMap((key) => {
    const bound = shortcuts(acceptCommandId(key))
    return bound.map(canonicalKey)
  }))
}

export function ghostKeymapLayers(
  composerCommands: KeymapCommand[],
  enabled: boolean,
  suggest: KeymapCommand["run"],
): KeymapLayer[] {
  return [
    { mode: "base", priority: 2, commands: composerCommands },
    {
      mode: "global",
      commands: [{
        id: "ghost.suggest",
        title: `Prompt suggestions: ${enabled ? "on" : "off"}`,
        description: "Toggle the suggested next prompt",
        group: "Prompt",
        palette: true,
        slash: { name: "suggest", arguments: true },
        run: suggest,
      }],
    },
  ]
}
