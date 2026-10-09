import { expect, test } from "bun:test"
import { InternalKeyHandler, KeyEvent } from "@opentui/core"
import { canonicalKey, composerAction, composerBlocker, findComposerEditor, keyName, locateComposerEditor, observeComposerInput, type Editor, type EditorNode } from "../src/composer"
import { createLifecycle } from "../src/lifecycle"

test("input cancellation runs before consuming keymap listeners, aborts active generation and cleans up", async () => {
  for (const name of ["backspace", "return", "x", "v"]) {
    const input = new InternalKeyHandler()
    const order: string[] = []
    let visible = true
    let signal: AbortSignal | undefined
    let finish!: () => void
    const lifecycle = createLifecycle(0, () => true, async (_id, current) => {
      signal = current
      await new Promise<void>((resolve) => { finish = resolve })
      if (!current.aborted) visible = true
    }, () => { visible = false })
    const active = lifecycle.run("session")
    visible = true
    input.prependListener("keypress", (event) => { order.push("keymap"); event.preventDefault(); event.stopPropagation() })
    const off = observeComposerInput(input, () => false, () => { order.push("cancel"); lifecycle.cancel() })
    input.emit("keypress", new KeyEvent({ name, ctrl: name === "v", meta: false, shift: false, option: false, sequence: name, raw: name, number: false, eventType: "press", source: "raw" }))
    expect(order).toEqual(["cancel", "keymap"])
    expect(signal?.aborted).toBe(true)
    expect(visible).toBe(false)
    finish()
    await active
    expect(visible).toBe(false)
    off()
    expect(input.listenerCount("keypress")).toBe(1)
    expect(input.listenerCount("paste")).toBe(0)
    lifecycle.dispose()
  }
})

test("eligible configured accept keys survive pre-dispatch observation; editing keys and paste cancel", () => {
  const input = new InternalKeyHandler()
  const order: string[] = []
  let eligible = true
  input.prependListener("keypress", (event) => { order.push(keyName(event)); event.stopPropagation() })
  input.prependListener("paste", (event) => { order.push("paste"); event.stopPropagation() })
  const off = observeComposerInput(input, (event) => eligible && ["tab", "shift+tab", "right", "y"].includes(keyName(event)), () => { order.push("cancel") })
  const press = (name: string, shift = false, sequence = name) => input.emit("keypress", new KeyEvent({ name, shift, ctrl: false, meta: false, option: false, sequence, raw: sequence, number: false, eventType: "press", source: "raw" }))
  press("tab")
  press("tab", true)
  press("right")
  press("y")
  expect(order).toEqual(["tab", "shift+tab", "right", "y"])
  eligible = false
  press("y")
  press("a")
  input.processPaste(new TextEncoder().encode("draft"))
  expect(order.slice(4)).toEqual(["cancel", "y", "cancel", "a", "cancel", "paste"])
  off()
})

test("navigation and non-text keys leave the suggestion and generation untouched", () => {
  const input = new InternalKeyHandler()
  let cancelled = 0
  const off = observeComposerInput(input, () => false, () => { cancelled++ })
  const press = (name: string, sequence: string, mods: { ctrl?: boolean; meta?: boolean } = {}) =>
    input.emit("keypress", new KeyEvent({ name, ctrl: !!mods.ctrl, meta: !!mods.meta, shift: false, option: false, sequence, raw: sequence, number: false, eventType: "press", source: "raw" }))
  for (const [name, sequence] of [["pageup", "\u001b[5~"], ["pagedown", "\u001b[6~"], ["left", "\u001b[D"], ["up", "\u001b[A"], ["home", "\u001b[H"], ["escape", "\u001b"], ["tab", "\t"], ["f1", "\u001bOP"], ["pageup", ""]] as const) press(name, sequence)
  press("c", "\u0003", { ctrl: true })
  press("p", "p", { ctrl: true })
  press("x", "x", { meta: true })
  expect(cancelled).toBe(0)
  for (const [name, sequence, mods] of [["a", "a", {}], ["A", "A", {}], ["é", "é", {}], ["space", " ", {}], ["return", "\r", {}], ["backspace", "\u007f", {}], ["delete", "\u001b[3~", {}], ["v", "\u0016", { ctrl: true }]] as const) press(name, sequence, mods)
  expect(cancelled).toBe(8)
  off()
})

function editor(): Editor {
  return { plainText: "", focused: true, isDestroyed: false, insertText(text) { this.plainText += text } }
}

test("accept inserts directly only into the focused empty composer", () => {
  const target = editor()
  expect(composerAction(target, () => target, "base", true, true, "next")).toBe(true)
  expect(target.plainText).toBe("next")
  expect(composerAction(target, () => target, "base", true, true, "next")).toBe(false)
  expect(target.plainText).toBe("next")
})

test("accept falls through for wrong focus, modes, session, missing suggestion and destroyed editors", () => {
  const target = editor()
  for (const [focus, mode, normal, allowed, text] of [
    [editor(), "base", true, true, "next"],
    [target, "dialog", true, true, "next"],
    [target, "base", false, true, "next"],
    [target, "base", true, false, "next"],
    [target, "base", true, true, undefined],
  ] as const) expect(composerAction(target, () => focus, mode, normal, allowed, text)).toBe(false)
  target.isDestroyed = true
  expect(composerAction(target, () => target, "base", true, true, "next")).toBe(false)
  expect(target.plainText).toBe("")
})

test("accept refuses drafts and detects insertion failures", () => {
  const target = editor()
  target.plainText = "user draft"
  expect(composerAction(target, () => target, "base", true, true, "next")).toBe(false)
  expect(target.plainText).toBe("user draft")
  target.plainText = ""
  target.insertText = () => {}
  expect(composerAction(target, () => target, "base", true, true, "next")).toBe(false)
  target.insertText = () => { throw new Error() }
  expect(composerAction(target, () => target, "base", true, true, "next")).toBe(false)
})

test("modifier matching does not confuse Shift+Tab, Alt or Super with plain acceptance", () => {
  const key = { name: "tab", ctrl: false, meta: false, shift: false }
  expect(keyName(key)).toBe("tab")
  expect(keyName({ ...key, shift: true })).toBe("shift+tab")
  expect(keyName({ ...key, option: true })).toBe("alt+tab")
  expect(keyName({ ...key, super: true })).toBe("super+tab")
  expect(canonicalKey(" Shift+CTRL+Right ")).toBe("ctrl+shift+right")
})

test("footer ancestry identifies only its own composer and refuses missing or ambiguous identity", () => {
  type Node = EditorNode & { editor?: boolean; composer?: boolean; children: Node[] }
  const node = (editor = false, composer = false): Node => ({ parent: null, isDestroyed: false, editor, composer, children: [], getChildren() { return this.children } })
  const attach = (parent: Node, ...children: Node[]) => { parent.children.push(...children); children.forEach((child) => { child.parent = parent }) }
  const root = node()
  const prompt = node()
  const footer = node()
  const marker = node()
  const target = node(true, true)
  const modal = node(true)
  attach(root, prompt, modal)
  attach(prompt, footer, target)
  attach(footer, marker)
  const find = () => findComposerEditor(marker, (item): item is Node => (item as Node).editor === true, (item) => item.composer === true)
  expect(find()).toBe(target)
  target.composer = false
  expect(find()).toBeUndefined()
  target.composer = true
  attach(prompt, node(true, true))
  expect(find()).toBeUndefined()
  marker.isDestroyed = true
  expect(find()).toBeUndefined()
  expect(findComposerEditor(undefined, (item): item is Node => false, () => true)).toBeUndefined()
})

test("locateComposerEditor and composerBlocker name the reason a composer is refused", () => {
  type Node = EditorNode & { editor?: boolean; composer?: boolean; children: Node[] }
  const node = (editor = false, composer = false): Node => ({ parent: null, isDestroyed: false, editor, composer, children: [], getChildren() { return this.children } })
  const attach = (parent: Node, ...children: Node[]) => { parent.children.push(...children); children.forEach((child) => { child.parent = parent }) }
  const root = node()
  const prompt = node()
  const marker = node()
  const target = node(true, true)
  attach(root, prompt)
  attach(prompt, marker, target)
  const locate = (...args: [] | [Node | undefined]) => locateComposerEditor(args.length ? args[0] : marker, (item): item is Node => (item as Node).editor === true, (item) => item.composer === true)
  expect(locate().editor).toBe(target)
  expect(locate(undefined).reason).toContain("no prompt.footer marker")
  target.composer = false
  expect(locate().reason).toContain("getClipboardText")
  target.composer = true
  attach(prompt, node(true, true))
  expect(locate().reason).toContain("2 editors")
  marker.isDestroyed = true
  expect(locate().reason).toContain("destroyed")

  const parent = { id: "prompt", isDestroyed: false, children: [] as unknown[], getChildren() { return this.children } }
  const editor = (over: Record<string, unknown> = {}) => {
    const value = { id: "editor", parent, isDestroyed: false, plainText: "", hasSelection: () => false, traits: {}, extmarks: { getAll: () => [] as unknown[] }, ...over }
    parent.children = [value, { id: "box-31" }]
    return value as never
  }
  expect(composerBlocker(undefined, "base", true, false)).toBe("no composer editor")
  const alone = { id: "editor", parent, isDestroyed: false, plainText: "", hasSelection: () => false, traits: {}, extmarks: { getAll: () => [] as unknown[] } } as never
  parent.children = [alone]
  expect(composerBlocker(alone, "base", true, false)).toContain("1 sibling nodes")
  parent.children = [{ id: "box-31" }, alone]
  expect(composerBlocker(alone, "base", true, false)).toContain("2 sibling nodes")
  expect(composerBlocker(editor(), "base", true, false)).toBeUndefined()
  expect(composerBlocker(editor(), "base", false, false)).toBe("prompt not in normal mode")
  expect(composerBlocker(editor(), "shell", true, false)).toBe("keymap mode is shell")
  expect(composerBlocker(editor({ plainText: "x" }), "base", true, false)).toBe("composer not empty")
  expect(composerBlocker(editor({ extmarks: { getAll: () => [1] } }), "base", true, false)).toBe("editor has 1 extmark(s)")
  const crowded = editor()
  parent.children = [crowded, { id: "box-31" }, { id: "extra" }]
  expect(composerBlocker(crowded, "base", true, false)).toContain("3 sibling nodes")
})
