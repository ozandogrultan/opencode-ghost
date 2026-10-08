/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { TextareaRenderable, InputRenderable, type BoxRenderable, type Renderable } from "@opentui/core"
import { createEffect, createMemo, createRoot, createSignal, on, onCleanup } from "solid-js"
import { composerAction, findComposerEditor, isEligibleComposer, isEmptyComposer, keyName, observeComposerInput } from "./composer"
import { createLifecycle } from "./lifecycle"
import { acceptCommand, acceptShortcuts, ghostKeymapLayers } from "./keymap"
import { parseSuggestCommand, removedOptionKeys, resolveOptions, suggestionModel } from "./options"
import { createInlinePlaceholder, dimPlaceholderColor } from "./placeholder"
import { generateSuggestion } from "./stateless"
import { isEcho, normalize, resolveExplicitModel, resolveSmallModel } from "./text"
import { buildTranscript, lastUserText, suggestionPrompt, type TranscriptMessage } from "./transcript"

type Suggestion = { sessionID: string; text: string }

function composerEditor(marker: Renderable | undefined): TextareaRenderable | undefined {
  return findComposerEditor(marker,
    (node): node is TextareaRenderable => node instanceof TextareaRenderable && !(node instanceof InputRenderable),
    (editor) => typeof (editor as unknown as { getClipboardText?: unknown }).getClipboardText === "function",
  )
}

export default Plugin.define({
  id: "ghost",
  setup(context) {
    const opts = resolveOptions(context.options)

    const removed = removedOptionKeys(context.options)
    if (removed.length > 0) {
      context.ui.toast.show({
        title: "Ghost",
        message: `Unsupported options ignored: ${removed.join(", ")}`,
        variant: "warning",
      })
    }

    const [state, updateState] = context.storage.store("state", {
      initial: { enabled: opts.enabled, model: undefined as string | undefined },
    })

    const [suggestion, setSuggestion] = createSignal<Suggestion | undefined>()
    const [composerRevision, setComposerRevision] = createSignal(0)
    const inline = createInlinePlaceholder()
    const ghostColor = createMemo(() => dimPlaceholderColor(context.theme.text.muted))

    let disposed = false
    const composers = new Map<string, { marker: BoxRenderable; normal: () => boolean }>()

    const isCurrentSession = (sessionID: string) => {
      const route = context.ui.router.current()
      return route.type === "session" && route.sessionID === sessionID
    }

    const canGenerate = (sessionID: string) =>
      !disposed && state.enabled && isCurrentSession(sessionID) && context.data.session.status(sessionID) === "idle"

    const warnGeneration = (error: unknown) => {
      lifecycle.warn(() => context.ui.toast.show({
        title: "Ghost",
        message: error instanceof Error && /^(No default small model|Invalid suggestion model)/.test(error.message)
          ? error.message
          : "Suggestions unavailable. Use /suggest model provider/model to select a supported generation model.",
        variant: "warning",
      }))
    }

    const generate = async (sessionID: string, signal: AbortSignal) => {
      if (!canGenerate(sessionID)) return
      try {
        await context.data.session.message.sync(sessionID)
        if (signal.aborted || !canGenerate(sessionID)) return
        const messages = context.data.session.message.list(sessionID) as readonly TranscriptMessage[]
        const transcript = buildTranscript(messages, opts.recentMessages)
        if (!transcript) return
        const session = context.data.session.get(sessionID)
        const location = session?.location ?? context.location ?? context.data.location.default()
        const explicit = suggestionModel(state.model, opts.model)
        const model = explicit
          ? resolveExplicitModel(context.client, location, signal, explicit)
          : resolveSmallModel(context.client, location, signal, session)
        const raw = await generateSuggestion(context.client, suggestionPrompt(opts.system, transcript), model, signal, warnGeneration, () => canGenerate(sessionID))
        if (signal.aborted || !raw) return
        const clean = normalize(raw, opts.maxChars)
        if (!clean) return
        const previous = lastUserText(messages)
        if (previous && isEcho(clean, previous)) return
        if (!canGenerate(sessionID)) return
        setSuggestion({ sessionID, text: clean })
      } catch (error) {
        if (!signal.aborted) warnGeneration(error)
      }
    }

    const lifecycle = createLifecycle(opts.idleDelayMs, canGenerate, generate, () => {
      inline.clear()
      setSuggestion(undefined)
    })
    const cancelSuggestion = lifecycle.cancel

    const offSucceeded = context.data.on("session.execution.succeeded", (event) => {
      lifecycle.succeeded(event.id, event.data.sessionID)
    })

    const offStarted = context.data.on("session.execution.started", (event) => {
      if (isCurrentSession(event.data.sessionID)) cancelSuggestion()
    })

    const getComposer = (sessionID: string) => {
      const entry = composers.get(sessionID)
      return { editor: composerEditor(entry?.marker), normal: entry?.normal() === true }
    }

    const isComposerEmpty = (sessionID: string) => {
      const { editor, normal } = getComposer(sessionID)
      return isEmptyComposer(editor, context.renderer.currentFocusedEditor, context.keymap.mode.current(), normal, context.renderer.hasSelection)
    }

    const syncInline = () => {
      composerRevision()
      const current = suggestion()
      const { editor, normal } = current ? getComposer(current.sessionID) : { editor: undefined, normal: false }
      inline.sync(editor, current?.text, ghostColor(), !!current && canGenerate(current.sessionID) && isEligibleComposer(editor, context.keymap.mode.current(), normal, context.renderer.hasSelection))
    }

    const disposeRouteWatcher = createRoot((dispose) => {
      createEffect(on(() => {
        const route = context.ui.router.current()
        return route.type === "session" ? route.sessionID : route.type
      }, cancelSuggestion, { defer: true }))
      createEffect(() => {
        const route = context.ui.router.current()
        if (!state.enabled || (route.type === "session" && context.data.session.status(route.sessionID) !== "idle")) cancelSuggestion()
      })
      createEffect(syncInline)
      return dispose
    })
    const beforeRender = async () => { syncInline() }
    context.renderer.setFrameCallback(beforeRender)

    const act = (sessionID: string) => {
      syncInline()
      const current = suggestion()
      if (!current || current.sessionID !== sessionID) return false
      const { editor, normal } = getComposer(sessionID)
      if (!inline.visible(editor, current.text) || !isComposerEmpty(sessionID)) return false
      if (!composerAction(editor, () => context.renderer.currentFocusedEditor, context.keymap.mode.current(), normal, canGenerate(sessionID), current.text)) return false
      inline.clear()
      setSuggestion(undefined)
      return true
    }

    const offInput = observeComposerInput(context.renderer.keyInput, (event) => {
      syncInline()
      const key = keyName(event)
      const current = suggestion()
      return Boolean(current && inline.visible(getComposer(current.sessionID).editor, current.text) && acceptShortcuts(opts.acceptKeys, context.keymap.shortcuts).has(key) && canGenerate(current.sessionID) && isComposerEmpty(current.sessionID))
    }, () => { lifecycle.interrupt(); inline.clear() })

    const commandLayers = () => ghostKeymapLayers([
        ...opts.acceptKeys.map((key) => acceptCommand(key, () => {
             const route = context.ui.router.current()
             return route.type === "session" ? route.sessionID : undefined
           }, () => suggestion()?.sessionID, act)),
        {
          id: "ghost.home",
          bind: "left",
          enabled: () => opts.backOnEmptyLeft,
          run: () => {
            const route = context.ui.router.current()
            if (route.type !== "session") return false
            if (!isComposerEmpty(route.sessionID)) return false
            cancelSuggestion()
            context.ui.router.navigate({ type: "home" })
          },
        },
      ], state.enabled, async (input) => {
            const command = parseSuggestCommand(input)
            if (command.type === "model") {
              cancelSuggestion()
              await updateState((draft) => { draft.model = command.model })
              context.ui.toast.show({ message: `Suggestion model: ${state.model ?? opts.model ?? "OpenCode small default"}` })
              return
            }
            if (command.type === "invalid") {
              context.ui.toast.show({ message: "Use /suggest, /suggest model provider/model, or /suggest model clear", variant: "warning" })
              return
            }
            cancelSuggestion()
            const next = !state.enabled
            await updateState((draft) => {
              draft.enabled = next
            })
            if (!next) {
              context.ui.toast.show({ message: "Prompt suggestions: off" })
              return
            }
            context.ui.toast.show({ message: "Prompt suggestions: on" })
            const route = context.ui.router.current()
            if (route.type === "session") void lifecycle.run(route.sessionID)
      })
    context.keymap.layer(() => commandLayers()[0]!)
    context.keymap.layer(() => commandLayers()[1]!)

    const offComposer = context.ui.slot({
      append: "prompt.footer",
      render: (input) => {
        const [marker, setMarker] = createSignal<BoxRenderable>()
        createEffect(() => {
          const sessionID = input.sessionID
          const node = marker()
          if (!sessionID || !node) return
          composers.set(sessionID, { marker: node, normal: () => input.mode === "normal" })
          setComposerRevision((value) => value + 1)
          onCleanup(() => {
            if (composers.get(sessionID)?.marker === node) {
              composers.delete(sessionID)
              setComposerRevision((value) => value + 1)
              syncInline()
            }
          })
        })
        return <box width={0} height={0} ref={setMarker} />
      },
    })

    return () => {
      disposed = true
      lifecycle.dispose()
      context.renderer.removeFrameCallback(beforeRender)
      disposeRouteWatcher()
      offSucceeded()
      offStarted()
      offInput()
      offComposer()
    }
  },
})
