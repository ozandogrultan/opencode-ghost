export function parseModel(
  spec: string | undefined,
): { providerID: string; modelID: string } | undefined {
  if (!spec) return undefined
  const index = spec.indexOf("/")
  if (index <= 0 || index === spec.length - 1) return undefined
  return { providerID: spec.slice(0, index), modelID: spec.slice(index + 1) }
}

export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function clip(text: string, max: number): string {
  const value = collapse(text)
  if (value.length <= max) return value
  return value.slice(0, max - 1).trimEnd() + "…"
}

export function normalize(raw: string, maxChars: number): string | undefined {
  const first = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!first) return undefined
  const cleaned = first
    .replace(/^[`"'*\-_#\s]+/, "")
    .replace(/[`"'*_#\s]+$/, "")
    .replace(/[*`_]+/g, "")
    .trim()
  if (!cleaned || /^none\.?$/i.test(cleaned)) return undefined
  if (cleaned.length <= maxChars) return cleaned
  return cleaned.slice(0, maxChars - 1).trimEnd() + "…"
}

/**
 * Number of visual rows `text` occupies when word-wrapped to `width` columns.
 * Mirrors the greedy word wrap the prompt renderer uses, so a ghost can reserve
 * exactly as many rows as it needs. Long words break at the column boundary.
 */
export function wrapCount(text: string, width: number): number {
  if (width <= 0) return 1
  let lines = 1
  let col = 0
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let length = word.length
    if (col > 0) {
      if (col + 1 + length <= width) {
        col += 1 + length
        continue
      }
      lines += 1
      col = 0
    }
    while (length > width) {
      lines += 1
      length -= width
    }
    col = length
  }
  return lines
}

export function isEcho(suggestion: string, previous: string): boolean {
  const strip = (value: string) =>
    value
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/[.!?,;:]+$/, "")
  const next = strip(suggestion)
  const last = strip(previous)
  if (!next || !last) return false
  if (next === last) return true
  if (next.length >= 12 && last.includes(next)) return true
  if (last.length >= 12 && next.includes(last)) return true
  return false
}
