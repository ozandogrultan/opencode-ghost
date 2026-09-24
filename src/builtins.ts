/**
 * Builtin TUI slash commands. The plugin API does not expose the TUI's own
 * command palette, so the completable subset we observed in the shipped binary
 * is curated here. Names are fixed; descriptions are ours and only used for the
 * completion display.
 */
export type BuiltinCommand = {
  name: string
  description: string
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  { name: "new", description: "New session" },
  { name: "agent", description: "Cycle agent" },
  { name: "model", description: "Choose model" },
  { name: "mcp", description: "Toggle MCP servers" },
  { name: "open", description: "Command palette" },
  { name: "share", description: "Share session" },
  { name: "unshare", description: "Unshare session" },
  { name: "compact", description: "Compact session" },
  { name: "export", description: "Export session" },
  { name: "fork", description: "Fork session" },
  { name: "undo", description: "Undo messages" },
  { name: "redo", description: "Redo messages" },
  { name: "terminal", description: "Toggle terminal" },
  { name: "workspace", description: "Workspace controls" },
  { name: "suggest", description: "Toggle prompt suggestions" },
]
