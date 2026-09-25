/**
 * Pure slash-command completion: given the current prompt input, the pool of
 * known command names (configured commands, skills, and builtins) and optional
 * per-command argument hints, decide what ghost text to render and what Tab
 * should insert.
 */
export type CommandPool = {
  readonly name: string
  readonly description?: string
}

export type Completion = {
  /** Dimmed text rendered after the input, e.g. `warm` for `/keep`+`warm`. */
  ghost?: string
  /** What Tab places into the input when accepting. */
  insert?: string
  /** Argument options shown as `[a | b]`, filtered by the word in progress. */
  args?: string[]
}

/** Parse leading `/name args...` from the input; `args` is "" until a space exists. */
function parseSlash(input: string): { name: string; args: string; nameComplete: boolean } | undefined {
  if (!input.startsWith("/")) return undefined
  const line = input.split("\n")[0]
  const space = line.indexOf(" ")
  if (space === -1) return { name: line.slice(1), args: "", nameComplete: false }
  return { name: line.slice(1, space), args: line.slice(space + 1), nameComplete: true }
}

/** Options that still match the word being typed, excluding an exact hit. */
function matchOptions(typed: string, options: readonly string[]): string[] | undefined {
  const lower = typed.toLowerCase()
  const matches = options.filter(
    (option) => option.toLowerCase() !== lower && option.toLowerCase().startsWith(lower),
  )
  return matches.length > 0 ? matches : undefined
}

export function completeCommand(
  input: string,
  pool: readonly CommandPool[],
  argHints: Readonly<Record<string, readonly string[]>> = {},
): Completion | undefined {
  const parsed = parseSlash(input)
  if (!parsed) return undefined
  const lower = parsed.name.toLowerCase()
  const exact = pool.find((command) => command.name.toLowerCase() === lower)

  // Still typing the command name (no space yet).
  if (!parsed.nameComplete) {
    if (exact) {
      const hints = argHints[lower]
      return {
        args: hints ? [...hints] : undefined,
        insert: `/${exact.name} `,
      }
    }
    const matches = pool.filter((command) => command.name.toLowerCase().startsWith(lower))
    if (matches.length === 0) return undefined
    const next = matches[0]
    return { ghost: next.name.slice(parsed.name.length), insert: `/${next.name} ` }
  }

  // `/name args...`: complete the in-progress argument word against hints.
  const hintList = argHints[lower]
  if (!hintList) return undefined
  const matches = matchOptions(parsed.args, hintList)
  if (!matches) return undefined
  const ghost = matches[0].slice(parsed.args.length)
  const result: Completion = {
    ghost,
    insert: `/${parsed.name} ${parsed.args + ghost} `,
  }
  // Enumerate the accepted options only while the argument is still empty;
  // once part of the word is typed, ghost the rest of the matching option.
  if (parsed.args === "") result.args = matches
  return result
}
