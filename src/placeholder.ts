import type { TextareaRenderable } from "@opentui/core"

export type PlaceholderEditor = Pick<TextareaRenderable, "placeholder" | "placeholderColor" | "plainText" | "isDestroyed">

export function createInlinePlaceholder() {
  let owned: {
    editor: PlaceholderEditor
    original: PlaceholderEditor["placeholder"]
    originalColor: PlaceholderEditor["placeholderColor"]
    text: string
    color: PlaceholderEditor["placeholderColor"]
  } | undefined

  const clear = () => {
    if (!owned) return
    const { editor, original, originalColor, text, color } = owned
    owned = undefined
    if (editor.isDestroyed) return
    if (editor.placeholder === text) editor.placeholder = original
    if (editor.placeholderColor === color) editor.placeholderColor = originalColor
  }

  return {
    clear,
    visible(editor: PlaceholderEditor | undefined, text: string) {
      return !!owned && owned.editor === editor && !editor?.isDestroyed && editor?.plainText === "" && editor.placeholder === text && owned.text === text
    },
    sync(editor: PlaceholderEditor | undefined, text: string | undefined, color: PlaceholderEditor["placeholderColor"], eligible: boolean) {
      if (owned && owned.editor !== editor) clear()
      if (!editor || editor.isDestroyed || editor.plainText !== "" || !text || !eligible) {
        clear()
        return
      }
      if (!owned) {
        owned = { editor, original: editor.placeholder, originalColor: editor.placeholderColor, text, color }
      } else {
        if (editor.placeholder !== owned.text) owned.original = editor.placeholder
        if (editor.placeholderColor !== owned.color) owned.originalColor = editor.placeholderColor
        owned.text = text
      }
      if (editor.placeholderColor !== color) editor.placeholderColor = color
      owned.color = editor.placeholderColor
      if (editor.placeholder !== text) editor.placeholder = text
    },
  }
}
