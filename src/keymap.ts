import type { KeymapCommand, KeymapLayer } from "@opencode/plugin/tui/context"

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
