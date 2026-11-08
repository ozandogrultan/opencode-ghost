import type { KeymapCommand, KeymapLayer } from "@opencode/plugin/tui/context"
import { canonicalKey } from "./composer"

export const acceptCommandId = (key: string) => `ghost.accept.${key}`

export function acceptCommand(key: string, session: () => string | undefined, suggestionSession: () => string | undefined, act: (sessionID: string) => boolean, eligible: (sessionID: string) => boolean = () => true): KeymapCommand {
  return {
    id: acceptCommandId(key),
    bind: key,
    enabled: () => {
      const sessionID = session()
      return !!sessionID && suggestionSession() === sessionID && eligible(sessionID)
    },
    run: () => {
      const sessionID = session()
      if (!sessionID || suggestionSession() !== sessionID || !act(sessionID)) return false
    },
  }
}

export function acceptShortcuts(acceptKeys: readonly string[], shortcuts: (id: string) => readonly string[]): Set<string> {
  return new Set(acceptKeys.flatMap((key) => {
    const bound = shortcuts(acceptCommandId(key))
    return bound.map(canonicalKey)
  }))
}

export function ghostBaseLayer(composerCommands: KeymapCommand[], target?: KeymapLayer["target"]): KeymapLayer {
  return { mode: "base", priority: 2, ...(target ? { target } : {}), commands: composerCommands }
}

export function ghostSuggestLayer(enabled: boolean, suggest: KeymapCommand["run"]): KeymapLayer {
  return {
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
  }
}
