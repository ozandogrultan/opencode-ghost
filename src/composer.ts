import type { KeyEvent, KeyHandler, TextareaRenderable } from "@opentui/core"

export function observeComposerInput(input: KeyHandler, preserve: (event: KeyEvent) => boolean, cancel: () => void): () => void {
  const onKeypress = (event: KeyEvent) => {
    if (!preserve(event)) cancel()
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
  if (!editor?.parent || editor.parent.isDestroyed) return false
  const siblings = editor.parent.getChildren().filter((node) =>
    !(node.id.startsWith("slot-layout-") && node.getChildren().length === 0),
  )
  if (siblings.length !== 2 || siblings[0] !== editor) return false
  return !!editor && normal && mode === "base" && !selected && editor === focused && editor.focused && !editor.isDestroyed && editor.plainText === "" && !editor.hasSelection() && !editor.traits.capture?.includes("navigate") && editor.extmarks.getAll().length === 0
}

export function findComposerEditor<T extends EditorNode>(marker: EditorNode | undefined, isEditor: (node: EditorNode) => node is T, isComposer: (editor: T) => boolean): T | undefined {
  if (!marker || marker.isDestroyed) return
  const editors = (node: EditorNode): T[] => isEditor(node) ? [node] : node.getChildren().flatMap(editors)
  for (let node = marker.parent; node && node.parent; node = node.parent) {
    if (node.isDestroyed) return
    const found = editors(node)
    if (found.length > 1) return
    if (found.length === 1) return isComposer(found[0]) ? found[0] : undefined
  }
}

export function composerAction(editor: Editor | undefined, focused: () => unknown, mode: string, normal: boolean, allowed: boolean, text: string | undefined): boolean {
  if (!allowed || !text || !editor || editor !== focused() || !editor.focused || editor.isDestroyed || mode !== "base" || !normal) return false
  if (editor.plainText.length !== 0) return false
  try {
    editor.insertText(text)
    if (editor.plainText !== text) return false
    return true
  } catch {
    return false
  }
}

export function keyName(event: { name: string; ctrl: boolean; meta: boolean; shift: boolean; option?: boolean; super?: boolean; hyper?: boolean }): string {
  return [event.ctrl && "ctrl", (event.meta || event.option) && "alt", event.shift && "shift", event.super && "super", event.hyper && "hyper", event.name].filter(Boolean).join("+")
}

export function canonicalKey(key: string): string {
  const parts = key.trim().toLowerCase().split("+")
  const name = parts.pop() ?? ""
  return [...["ctrl", "alt", "shift", "super", "hyper"].filter((modifier) => parts.includes(modifier)), name].join("+")
}
