import type { KeyEvent, KeyHandler, TextareaRenderable } from "@opentui/core"

export function editsComposer(event: { name: string; sequence: string; ctrl: boolean; meta: boolean; option?: boolean; super?: boolean; hyper?: boolean }): boolean {
  if (event.ctrl && !event.meta && !event.option && !event.super && !event.hyper) return ["v", "h", "d", "k", "u", "w", "j", "m"].includes(event.name)
  if (event.ctrl || event.meta || event.option || event.super || event.hyper) return false
  if (["return", "enter", "linefeed", "backspace", "delete", "space"].includes(event.name)) return true
  return [...event.sequence].length === 1 && !/[\u0000-\u001f\u007f]/.test(event.sequence)
}

export function removesOnly(event: { name: string; ctrl: boolean; meta: boolean; option?: boolean; super?: boolean; hyper?: boolean }): boolean {
  if (event.ctrl && !event.meta && !event.option && !event.super && !event.hyper) return ["h", "d", "k", "u", "w"].includes(event.name)
  if (event.ctrl || event.meta || event.option || event.super || event.hyper) return false
  return event.name === "backspace" || event.name === "delete"
}

export function observeComposerInput(input: KeyHandler, preserve: (event: KeyEvent) => boolean, cancel: () => void): () => void {
  const onKeypress = (event: KeyEvent) => {
    if (editsComposer(event) && !preserve(event)) cancel()
  }
  input.prependListener("keypress", onKeypress)
  input.prependListener("paste", cancel)
  return () => {
    input.off("keypress", onKeypress)
    input.off("paste", cancel)
  }
}

export type Editor = {
  plainText: string
  focused: boolean
  isDestroyed: boolean
  insertText(text: string): void
}

export type EditorNode = {
  parent: EditorNode | null
  isDestroyed: boolean
  getChildren(): EditorNode[]
}

export function isEmptyComposer(editor: TextareaRenderable | undefined, focused: unknown, mode: string, normal: boolean, selected: boolean): boolean {
  return !!editor && editor === focused && editor.focused && isEligibleComposer(editor, mode, normal, selected)
}

export function composerBlocker(editor: TextareaRenderable | undefined, mode: string, normal: boolean, selected: boolean): string | undefined {
  if (!editor) return "no composer editor"
  if (!editor.parent || editor.parent.isDestroyed) return "editor detached"
  if (!normal) return "prompt not in normal mode"
  if (mode !== "base") return `keymap mode is ${mode}`
  if (selected) return "renderer has a selection"
  if (editor.isDestroyed) return "editor destroyed"
  if (editor.plainText !== "") return "composer not empty"
  if (editor.hasSelection()) return "editor has a selection"
  if (editor.traits.capture?.includes("navigate")) return "editor captures navigation"
  const marks = editor.extmarks.getAll().length
  if (marks !== 0) return `editor has ${marks} extmark(s)`
}

export function isEligibleComposer(editor: TextareaRenderable | undefined, mode: string, normal: boolean, selected: boolean): boolean {
  return composerBlocker(editor, mode, normal, selected) === undefined
}

export type ComposerLookup<T> = { editor: T; reason?: undefined } | { editor?: undefined; reason: string }

export function locateComposerEditor<T extends EditorNode>(marker: EditorNode | undefined, isEditor: (node: EditorNode) => node is T, isComposer: (editor: T) => boolean): ComposerLookup<T> {
  if (!marker) return { reason: "no prompt.footer marker registered" }
  if (marker.isDestroyed) return { reason: "prompt.footer marker destroyed" }
  const editors = (node: EditorNode): T[] => isEditor(node) ? [node] : node.getChildren().flatMap(editors)
  for (let node = marker.parent; node && node.parent; node = node.parent) {
    if (node.isDestroyed) return { reason: "marker ancestor destroyed" }
    const found = editors(node)
    if (found.length > 1) return { reason: `${found.length} editors share the marker ancestor` }
    if (found.length === 1) return isComposer(found[0]) ? { editor: found[0] } : { reason: "editor lacks getClipboardText (not the host composer)" }
  }
  return { reason: "no editor found above the marker" }
}

export function findComposerEditor<T extends EditorNode>(marker: EditorNode | undefined, isEditor: (node: EditorNode) => node is T, isComposer: (editor: T) => boolean): T | undefined {
  return locateComposerEditor(marker, isEditor, isComposer).editor
}

export function composerAction(editor: Editor | undefined, focused: () => unknown, mode: string, normal: boolean, allowed: boolean, text: string | undefined): boolean {
  if (!allowed || !text || !editor || editor !== focused() || !editor.focused || editor.isDestroyed || mode !== "base" || !normal) return false
  if (editor.plainText.length !== 0) return false
  try {
    editor.insertText(text)
  } catch {}
  return true
}

export function keyName(event: { name: string; ctrl: boolean; meta: boolean; shift: boolean; option?: boolean; super?: boolean; hyper?: boolean }): string {
  return [event.ctrl && "ctrl", (event.meta || event.option) && "alt", event.shift && "shift", event.super && "super", event.hyper && "hyper", event.name].filter(Boolean).join("+")
}

const MODIFIERS = ["ctrl", "alt", "shift", "super", "hyper"]

const KEY_ALIASES: Record<string, string> = {
  control: "ctrl",
  meta: "alt",
  option: "alt",
  opt: "alt",
  cmd: "super",
  command: "super",
  win: "super",
  esc: "escape",
}

export function canonicalKey(key: string): string {
  const parts = key.trim().toLowerCase().split("+").map((part) => KEY_ALIASES[part] ?? part)
  const name = parts.pop() ?? ""
  return [...MODIFIERS.filter((modifier) => parts.includes(modifier)), name].join("+")
}

export function isValidKey(key: string): boolean {
  const parts = key.trim().toLowerCase().split("+").map((part) => part.trim())
  const name = parts.pop()
  return !!name && parts.every((part) => MODIFIERS.includes(KEY_ALIASES[part] ?? part))
}
