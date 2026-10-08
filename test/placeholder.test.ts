import { expect, test } from "bun:test"
import { BoxRenderable, RGBA, StyledText, TextareaRenderable, TextRenderable, dim } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { composerAction, isEligibleComposer, isEmptyComposer } from "../src/composer"
import { createInlinePlaceholder, dimPlaceholderColor } from "../src/placeholder"
import { createLifecycle } from "../src/lifecycle"
import { generateSuggestion } from "../src/stateless"

const muted = RGBA.fromHex("#777777")

async function withEditor(run: (editor: TextareaRenderable, setup: Awaited<ReturnType<typeof createTestRenderer>>) => void | Promise<void>) {
  const setup = await createTestRenderer({ width: 60, height: 8 })
  const editor = new TextareaRenderable(setup.renderer, { id: "composer", width: 60, height: 3, placeholder: new StyledText([dim("Original hint")]), placeholderColor: "#999999" })
  setup.renderer.root.add(editor)
  editor.focus()
  try {
    await run(editor, setup)
  } finally {
    setup.renderer.destroy()
  }
}

test("ghost color blends toward dark and light composer backgrounds without changing theme or host colors", async () => {
  await withEditor(async (editor, setup) => {
    const inline = createInlinePlaceholder()
    const original = editor.placeholder
    const originalColor = editor.placeholderColor
    const foreground = editor.textColor
    for (const [background, themeMuted] of [["#202020", "#a0b0c0"], ["#eeeeee", "#506070"]]) {
      editor.backgroundColor = background
      editor.focusedBackgroundColor = background
      const themeColor = RGBA.fromHex(themeMuted)
      const snapshot = themeColor.toInts()
      const ghostColor = dimPlaceholderColor(themeColor)
      expect(ghostColor).not.toBe(themeColor)
      expect(ghostColor.a).toBeCloseTo(0.55, 2)
      expect(themeColor.toInts()).toEqual(snapshot)
      inline.sync(editor, "Next prompt", ghostColor, true)
      await setup.renderOnce()
      const span = setup.captureSpans().lines[0].spans.find((span) => span.text.includes("Next prompt"))!
      const bg = RGBA.fromHex(background).toInts()
      for (let channel = 0; channel < 3; channel++) {
        expect(span.fg!.toInts()[channel]).toBeCloseTo(Math.round(snapshot[channel] * ghostColor.a + bg[channel] * (1 - ghostColor.a)), 0)
      }
      expect(editor.textColor).toBe(foreground)
      expect(editor.plainText).toBe("")
    }
    inline.clear()
    expect(editor.placeholder).toBe(original)
    expect(editor.placeholderColor).toBe(originalColor)
  })
})

test("ghost renders inside the real empty textarea without changing buffer or undo; restores rich hint and color", async () => {
  await withEditor(async (editor, setup) => {
    const inline = createInlinePlaceholder()
    const original = editor.placeholder
    const originalColor = editor.placeholderColor
    inline.sync(editor, "Next prompt", muted, true)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Next prompt")
    expect(editor.plainText).toBe("")
    expect(editor.placeholderColor).toBe(muted)
    expect(inline.visible(editor, "Next prompt")).toBe(true)
    editor.undo()
    expect(editor.plainText).toBe("")
    inline.clear()
    expect(editor.placeholder).toBe(original)
    expect(editor.placeholderColor).toBe(originalColor)
  })
})

test("pre-render synchronization preserves host placeholder and color updates while keeping the ghost visible", async () => {
  await withEditor(async (editor, setup) => {
    const inline = createInlinePlaceholder()
    const sync = async () => { inline.sync(editor, "Next prompt", muted, true) }
    setup.renderer.setFrameCallback(sync)
    inline.sync(editor, "Next prompt", muted, true)
    const updated = new StyledText([dim("Updated host hint")])
    const updatedColor = RGBA.fromHex("#aaaaaa")
    editor.placeholder = updated
    editor.placeholderColor = updatedColor
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain("Next prompt")
    expect(editor.plainText).toBe("")
    setup.renderer.removeFrameCallback(sync)
    inline.clear()
    expect(editor.placeholder).toBe(updated)
    expect(editor.placeholderColor).toBe(updatedColor)
  })
})

test("dismissal does not overwrite host changes made since the last synchronization", async () => {
  await withEditor((editor) => {
    const inline = createInlinePlaceholder()
    inline.sync(editor, "Next prompt", muted, true)
    const updated = new StyledText([dim("Latest hint")])
    const updatedColor = RGBA.fromHex("#aaaaaa")
    editor.placeholder = updated
    editor.placeholderColor = updatedColor
    inline.clear()
    expect(editor.placeholder).toBe(updated)
    expect(editor.placeholderColor).toBe(updatedColor)
  })
})

test("typing, ineligible focus/mode, disable/navigation, missing suggestion and unload restore the host hint", async () => {
  await withEditor((editor) => {
    const original = editor.placeholder
    const color = editor.placeholderColor
    for (const reason of ["typing", "ineligible", "disabled", "navigation", "dismiss", "unload"]) {
      const inline = createInlinePlaceholder()
      inline.sync(editor, "Next prompt", muted, true)
      if (reason === "typing") editor.insertText("draft")
      if (reason === "unload") inline.clear()
      else inline.sync(reason === "navigation" ? undefined : editor, reason === "dismiss" ? undefined : "Next prompt", muted, reason === "typing")
      expect(inline.visible(editor, "Next prompt")).toBe(false)
      expect(editor.placeholder).toBe(original)
      expect(editor.placeholderColor).toBe(color)
      expect(editor.plainText).toBe(reason === "typing" ? "draft" : "")
      editor.setText("")
    }
  })
})

test("replacing editors restores the old editor and snapshots the replacement; destroyed editor cleanup is safe", async () => {
  await withEditor((editor, setup) => {
    const inline = createInlinePlaceholder()
    const original = editor.placeholder
    const replacement = new TextareaRenderable(setup.renderer, { id: "replacement", placeholder: "Other hint" })
    setup.renderer.root.add(replacement)
    inline.sync(editor, "Next prompt", muted, true)
    inline.sync(replacement, "Other prompt", muted, true)
    expect(editor.placeholder).toBe(original)
    expect(replacement.placeholder).toBe("Other prompt")
    inline.clear()
    expect(replacement.placeholder).toBe("Other hint")
    inline.sync(editor, "Next prompt", muted, true)
    editor.destroy()
    expect(inline.visible(editor, "Next prompt")).toBe(false)
    expect(() => inline.clear()).not.toThrow()
  })
})

test("only accepting a visible eligible ghost materializes text; placeholder never submits itself", async () => {
  await withEditor((editor) => {
    const inline = createInlinePlaceholder()
    inline.sync(editor, "Next prompt", muted, true)
    let submitted = "unset"
    editor.onSubmit = () => { submitted = editor.plainText }
    editor.submit()
    expect(submitted).toBe("")
    expect(composerAction(editor, () => editor, "dialog", true, inline.visible(editor, "Next prompt"), "Next prompt")).toBe(false)
    expect(composerAction(editor, () => editor, "base", false, inline.visible(editor, "Next prompt"), "Next prompt")).toBe(false)
    expect(editor.plainText).toBe("")
    expect(composerAction(editor, () => editor, "base", true, inline.visible(editor, "Next prompt"), "Next prompt")).toBe(true)
    inline.clear()
    expect(editor.plainText).toBe("Next prompt")
    expect(submitted).toBe("")
    editor.undo()
    expect(editor.plainText).toBe("")
    expect(composerAction(editor, () => editor, "base", true, inline.visible(editor, "Next prompt"), "Next prompt")).toBe(false)
  })
})

test("the real composer gate suppresses autocomplete, attachments, selections, wrong focus and modes", async () => {
  await withEditor((editor, setup) => {
    const body = new BoxRenderable(setup.renderer, { id: "body" })
    setup.renderer.root.remove(editor)
    setup.renderer.root.add(body)
    body.add(editor)
    body.add(new BoxRenderable(setup.renderer, { id: "metadata" }))
    const eligible = () => isEmptyComposer(editor, editor, "base", true, false)
    expect(eligible()).toBe(true)
    const slot = new BoxRenderable(setup.renderer, { id: "slot-layout-slot-node-24-1" })
    body.add(slot, 0)
    expect(eligible()).toBe(true)
    const slotContent = new TextRenderable(setup.renderer, { id: "slot-content", content: "Attachment" })
    slot.add(slotContent)
    expect(eligible()).toBe(false)
    slotContent.destroy()
    expect(eligible()).toBe(true)
    editor.traits = { capture: ["escape", "navigate", "submit", "tab"] }
    expect(eligible()).toBe(false)
    editor.traits = { capture: ["tab"] }
    const attachment = editor.extmarks.create({ start: 0, end: 0, virtual: true })
    expect(eligible()).toBe(false)
    editor.extmarks.delete(attachment)
    expect(eligible()).toBe(true)
    expect(isEmptyComposer(editor, editor, "base", true, true)).toBe(false)
    expect(isEmptyComposer(editor, undefined, "base", true, false)).toBe(false)
    expect(isEmptyComposer(editor, editor, "dialog", true, false)).toBe(false)
    expect(isEmptyComposer(editor, editor, "base", false, false)).toBe(false)
    editor.blur()
    expect(eligible()).toBe(false)
  })
})

test("blur preserves the rendered ghost while acceptance requires composer focus", async () => {
  await withEditor(async (editor, setup) => {
    const body = new BoxRenderable(setup.renderer, { id: "body" })
    setup.renderer.root.remove(editor)
    setup.renderer.root.add(body)
    body.add(editor)
    body.add(new BoxRenderable(setup.renderer, { id: "metadata" }))
    const inline = createInlinePlaceholder()
    const original = editor.placeholder
    const originalColor = editor.placeholderColor
    const sync = () => inline.sync(editor, "Next prompt", muted, isEligibleComposer(editor, "base", true, false))
    sync()
    expect(inline.visible(editor, "Next prompt")).toBe(true)
    editor.blur()
    sync()
    await setup.renderOnce()
    expect(inline.visible(editor, "Next prompt")).toBe(true)
    expect(setup.captureSpans().lines.some((line) => line.spans.some((span) => span.text.includes("Next prompt")))).toBe(true)
    expect(isEmptyComposer(editor, setup.renderer.currentFocusedEditor, "base", true, false)).toBe(false)
    expect(composerAction(editor, () => setup.renderer.currentFocusedEditor, "base", true, true, "Next prompt")).toBe(false)
    expect(editor.plainText).toBe("")
    editor.focus()
    sync()
    expect(isEmptyComposer(editor, setup.renderer.currentFocusedEditor, "base", true, false)).toBe(true)
    expect(composerAction(editor, () => setup.renderer.currentFocusedEditor, "base", true, true, "Next prompt")).toBe(true)
    inline.clear()
    expect(editor.placeholder).toBe(original)
    expect(editor.placeholderColor).toBe(originalColor)
  })
})

test("typing then deleting restores the original ghost without another generation", async () => {
  await withEditor(async (editor, setup) => {
    const body = new BoxRenderable(setup.renderer, { id: "body" })
    setup.renderer.root.remove(editor)
    setup.renderer.root.add(body)
    body.add(editor)
    body.add(new BoxRenderable(setup.renderer, { id: "metadata" }))
    const inline = createInlinePlaceholder()
    let suggestion: { sessionID: string; text: string } | undefined
    let calls = 0
    let sessionID = "first"
    const client = { generate: { text: async () => { calls++; return { text: "Original suggestion" } } } }
    const lifecycle = createLifecycle(0, (id) => id === sessionID, async (id, signal) => {
      const text = await generateSuggestion(client, "Prompt", { providerID: "fake", modelID: "small" }, signal)
      if (text && !signal.aborted) suggestion = { sessionID: id, text }
    }, () => { inline.clear(); suggestion = undefined })
    const sync = () => inline.sync(editor, suggestion?.text, muted, suggestion?.sessionID === sessionID && isEligibleComposer(editor, "base", true, false))
    try {
      await lifecycle.run(sessionID)
      sync()
      expect(inline.visible(editor, "Original suggestion")).toBe(true)
      lifecycle.interrupt()
      inline.clear()
      editor.insertText("Temporary input")
      sync()
      expect(inline.visible(editor, "Original suggestion")).toBe(false)
      editor.clear()
      sync()
      await setup.renderOnce()
      expect(inline.visible(editor, "Original suggestion")).toBe(true)
      expect(calls).toBe(1)
      editor.blur()
      sync()
      editor.focus()
      sync()
      expect(calls).toBe(1)
      expect(composerAction(editor, () => setup.renderer.currentFocusedEditor, "base", true, true, suggestion?.text)).toBe(true)
      inline.clear()
      suggestion = undefined
      editor.clear()
      sync()
      expect(inline.visible(editor, "Original suggestion")).toBe(false)
      await lifecycle.run(sessionID)
      sync()
      expect(inline.visible(editor, "Original suggestion")).toBe(true)
      sessionID = "second"
      lifecycle.cancel()
      sync()
      expect(suggestion).toBeUndefined()
      expect(inline.visible(editor, "Original suggestion")).toBe(false)
      expect(calls).toBe(2)
    } finally {
      lifecycle.dispose()
    }
  })
})

test("mentionless preview UI suppresses display and acceptance even when the image preview fails", async () => {
  await withEditor((editor, setup) => {
    const body = new BoxRenderable(setup.renderer, { id: "body" })
    setup.renderer.root.remove(editor)
    setup.renderer.root.add(body)
    body.add(editor)
    body.add(new BoxRenderable(setup.renderer, { id: "metadata" }))
    const inline = createInlinePlaceholder()
    body.add(new BoxRenderable(setup.renderer, { id: "slot-layout-slot-node-24-1" }), 0)
    const sync = () => inline.sync(editor, "Next prompt", muted, isEmptyComposer(editor, editor, "base", true, false))
    sync()
    expect(inline.visible(editor, "Next prompt")).toBe(true)
    const previews = new BoxRenderable(setup.renderer, { id: "previews" })
    const thumbnail = new BoxRenderable(setup.renderer, { id: "thumbnail" })
    previews.add(thumbnail)
    body.add(previews, 0)
    expect(editor.extmarks.getAll()).toEqual([])
    sync()
    expect(inline.visible(editor, "Next prompt")).toBe(false)
    expect(composerAction(editor, () => editor, "base", true, isEmptyComposer(editor, editor, "base", true, false), "Next prompt")).toBe(false)
    thumbnail.add(new TextRenderable(setup.renderer, { id: "failed-preview", content: "No preview" }))
    sync()
    expect(inline.visible(editor, "Next prompt")).toBe(false)
    expect(editor.plainText).toBe("")
    previews.destroy()
    sync()
    expect(inline.visible(editor, "Next prompt")).toBe(true)
    inline.clear()
  })
})
