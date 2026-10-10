/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { TextareaRenderable, InputRenderable, type BoxRenderable, type Renderable } from "@opentui/core"
import { createEffect, createMemo, createRoot, createSignal, on, onCleanup } from "solid-js"
import { composerAction, composerBlocker, isEmptyComposer, keyName, locateComposerEditor, observeComposerInput, removesOnly, type ComposerLookup } from "./composer"
import { createDiagnostics, errorDetail, formatDiagnostic, formatDiagnostics, modelLabel, type DiagnosticEntry, type StageTimings } from "./diagnostics"
import { createLifecycle } from "./lifecycle"
import { acceptCommand, acceptShortcuts, ghostBaseLayer, ghostSuggestLayer } from "./keymap"
import { parseSuggestCommand, removedOptionKeys, resolveOptions, suggestionModel } from "./options"
import { createInlinePlaceholder, dimPlaceholderColor } from "./placeholder"
import { generateSuggestion } from "./stateless"
import { createCatalog, isEcho, isNoSmallModel, normalize, resolveExplicitModel, resolveSmallModel, type SuggestionModel } from "./text"
import { buildTranscript, lastUserText, suggestionPrompt, type TranscriptMessage } from "./transcript"

type Suggestion = { sessionID: string; text: string }

function lookupComposer(marker: Renderable | undefined): ComposerLookup<TextareaRenderable> {
  return locateComposerEditor(marker,
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
      initial: { enabled: opts.enabled, model: undefined as string | undefined, debug: false },
    })

    const [suggestion, setSuggestion] = createSignal<Suggestion | undefined>()
    const [composerRevision, setComposerRevision] = createSignal(0)
    const inline = createInlinePlaceholder()
    let ghostColor: () => ReturnType<typeof dimPlaceholderColor>
    const diagnostics = createDiagnostics()
    const catalog = createCatalog(context.client)

    const note = (entry: Omit<DiagnosticEntry, "at">) => {
      const recorded = diagnostics.record(entry)
      if (state.debug === true && recorded.outcome !== "aborted") {
        context.ui.toast.show({ title: "Ghost", message: formatDiagnostic(recorded) })
      }
      return recorded
    }

    let disposed = false
    let syncWarned = false
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
      const started = Date.now()
      const elapsed = () => Date.now() - started
      const stages: StageTimings = {}
      const measure = async <T,>(stage: keyof StageTimings, run: () => Promise<T>): Promise<T> => {
        const start = Date.now()
        try {
          return await run()
        } finally {
          stages[stage] = Date.now() - start
        }
      }
      const noteGeneration = (entry: Omit<DiagnosticEntry, "at" | "sessionID" | "durationMs" | "stages">) =>
        note({ ...entry, sessionID, durationMs: elapsed(), stages: { ...stages } })
      let model: SuggestionModel | undefined
      let failure: unknown
      let syncing = true
      try {
        await measure("syncMs", () => context.data.session.message.sync(sessionID))
        syncing = false
        if (signal.aborted || !canGenerate(sessionID)) return
        const messages = context.data.session.message.list(sessionID) as readonly TranscriptMessage[]
        const transcript = buildTranscript(messages, opts.recentMessages)
        if (!transcript) return
        const session = context.data.session.get(sessionID)
        const location = session?.location ?? context.location ?? context.data.location.default()
        const explicit = suggestionModel(state.model, opts.model)
        model = await measure("modelMs", () => explicit
          ? resolveExplicitModel(context.client, location, signal, explicit, catalog)
          : resolveSmallModel(context.client, location, signal, session, catalog))
        if (signal.aborted || !canGenerate(sessionID)) return
        if (!model) return
        const raw = await measure("generationMs", () => generateSuggestion(
          context.client,
          suggestionPrompt(opts.system, transcript, opts.maxChars),
          model,
          signal,
          (error) => { failure = error; warnGeneration(error) },
          () => canGenerate(sessionID),
        ))
        const label = modelLabel(model)
        if (signal.aborted) return
        if (failure) {
          noteGeneration({ outcome: "error", model: label, detail: errorDetail(failure) })
          return
        }
        if (!raw) {
          if (!canGenerate(sessionID)) return
          noteGeneration({ outcome: "empty", model: label })
          return
        }
        const clean = normalize(raw, opts.maxChars)
        if (!clean) {
          noteGeneration({ outcome: "empty", model: label, chars: raw.length })
          return
        }
        const previous = lastUserText(messages)
        if (previous && isEcho(clean, previous)) {
          noteGeneration({ outcome: "echo", model: label, chars: clean.length })
          return
        }
        if (!canGenerate(sessionID)) return
        setSuggestion({ sessionID, text: clean })
        noteGeneration({ outcome: "ok", model: label, chars: clean.length })
      } catch (error) {
        if (signal.aborted) return
        if (syncing) {
          if (!disposed && !syncWarned) {
            syncWarned = true
            context.ui.toast.show({ title: "Ghost", message: "Suggestions unavailable: session messages could not sync.", variant: "warning" })
          }
        } else warnGeneration(error)
        noteGeneration({
          outcome: isNoSmallModel(error) ? "unavailable" : "error",
          ...(model ? { model: modelLabel(model) } : {}),
          detail: errorDetail(error),
        })
      } finally {
        if (signal.aborted) noteGeneration({ outcome: "aborted", ...(model ? { model: modelLabel(model) } : {}) })
      }
    }

    const lifecycle = createLifecycle(opts.idleDelayMs, canGenerate, generate, () => {
      inline.clear()
      setSuggestion(undefined)
    }, (sessionID) => !disposed && state.enabled && isCurrentSession(sessionID))
    const cancelSuggestion = lifecycle.cancel

    const offSucceeded = context.data.on("session.execution.succeeded", (event) => {
      lifecycle.succeeded(event.id, event.data.sessionID)
    })

    const offStarted = context.data.on("session.execution.started", (event) => {
      if (isCurrentSession(event.data.sessionID)) cancelSuggestion()
    })

    const getComposer = (sessionID: string) => {
      const entry = composers.get(sessionID)
      return { editor: lookupComposer(entry?.marker).editor, normal: entry?.normal() === true }
    }

    const displayLog = createDiagnostics()
    let lastDisplay: string | undefined

    const inspect = (current: Suggestion) => {
      const entry = composers.get(current.sessionID)
      const found = lookupComposer(entry?.marker)
      const allowed = canGenerate(current.sessionID)
      const blocker = found.editor
        ? composerBlocker(found.editor, context.keymap.mode.current(), entry?.normal() === true, context.renderer.hasSelection)
        : found.reason
      return { editor: found.editor, allowed, blocker }
    }

    const displayStatus = (current: Suggestion, view = inspect(current)): string => {
      if (!view.allowed) return "session busy, hidden or suggestions disabled"
      if (view.blocker) return view.blocker
      return inline.visible(view.editor, current.text) ? "shown" : "placeholder not applied (host overrode it)"
    }

    const trackDisplay = (current: Suggestion | undefined, view?: ReturnType<typeof inspect>) => {
      if (!current) {
        lastDisplay = undefined
        return
      }
      const status = displayStatus(current, view)
      if (status === lastDisplay) return
      lastDisplay = status
      const recorded = displayLog.record({
        sessionID: current.sessionID,
        outcome: status === "shown" ? "shown" : "hidden",
        chars: current.text.length,
        ...(status === "shown" ? {} : { detail: status }),
      })
      if (state.debug === true) context.ui.toast.show({ title: "Ghost", message: formatDiagnostic(recorded) })
    }

    const isComposerEmpty = (sessionID: string) => {
      const { editor, normal } = getComposer(sessionID)
      return isEmptyComposer(editor, context.renderer.currentFocusedEditor, context.keymap.mode.current(), normal, context.renderer.hasSelection)
    }

    const syncInline = () => {
      composerRevision()
      const current = suggestion()
      const color = ghostColor()
      if (!current) {
        inline.sync(undefined, undefined, color, false)
        trackDisplay(undefined)
        return
      }
      const view = inspect(current)
      inline.sync(view.editor, current.text, color, view.allowed && !view.blocker)
      trackDisplay(current, view)
    }

    const disposeRouteWatcher = createRoot((dispose) => {
      ghostColor = createMemo(() => dimPlaceholderColor(context.theme.text.muted))
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

    const targetedEditor = () => {
      const route = context.ui.router.current()
      if (route.type !== "session") return undefined
      const editor = getComposer(route.sessionID).editor
      return editor && editor === context.renderer.currentFocusedEditor ? editor : undefined
    }

    const pending = () => lifecycle.active() || suggestion() !== undefined

    const offInput = observeComposerInput(context.renderer.keyInput, (event) => {
      if (!pending()) return true
      const editor = targetedEditor()
      if (!editor) return true
      if (editor.plainText === "" && removesOnly(event)) return true
      const current = suggestion()
      if (!current) return false
      syncInline()
      return Boolean(inline.visible(editor, current.text) && acceptShortcuts(opts.acceptKeys, context.keymap.shortcuts).has(keyName(event)) && canGenerate(current.sessionID) && isComposerEmpty(current.sessionID))
    }, () => {
      if (!pending() || !targetedEditor()) return
      lifecycle.interrupt()
      inline.clear()
    })

    const acceptLayer = () => ghostBaseLayer(
      opts.acceptKeys.map((key) => acceptCommand(key, () => {
        const route = context.ui.router.current()
        return route.type === "session" ? route.sessionID : undefined
      }, () => suggestion()?.sessionID, act)),
    )
    const suggestLayer = () => ghostSuggestLayer(state.enabled, async (input) => {
            const command = parseSuggestCommand(input)
            if (command.type === "model") {
              cancelSuggestion()
              lifecycle.resetWarning()
              catalog.clear()
              await updateState((draft) => { draft.model = command.model })
              context.ui.toast.show({ message: `Suggestion model: ${state.model ?? opts.model ?? "OpenCode small default"}` })
              return
            }
            if (command.type === "debug") {
              const next = command.value ?? (state.debug !== true)
              await updateState((draft) => { draft.debug = next })
              context.ui.toast.show({ message: `Ghost debug: ${next ? "on" : "off"}` })
              return
            }
            if (command.type === "log") {
              const override = state.model ?? opts.model
              const summary = `suggestions ${state.enabled ? "on" : "off"}, debug ${state.debug === true ? "on" : "off"}, model ${override ?? "OpenCode small default"}`
              const current = suggestion()
              const color = ghostColor()
              const route = context.ui.router.current()
              const entry = route.type === "session" ? composers.get(route.sessionID) : undefined
              const editor = lookupComposer(entry?.marker).editor
              const live = [
                `route ${route.type}`,
                `suggestion ${current ? `retained (${current.text.length} chars)` : "none"}`,
                `display ${current ? displayStatus(current) : "n/a"}`,
                `focused ${editor ? (editor === context.renderer.currentFocusedEditor && editor.focused ? "yes" : "no") : "n/a"}`,
                `mode ${context.keymap.mode.current()}`,
                `color rgba(${[color.r, color.g, color.b, color.a].map((value) => value.toFixed(2)).join(", ")})`,
              ].join("\n")
              void context.ui.dialog.alert({
                title: "Ghost — diagnostics",
                message: `${summary}\n\nNow\n${live}\n\nDisplay changes\n${displayLog.list().length ? formatDiagnostics(displayLog.list()) : "None recorded yet."}\n\nGenerations\n${formatDiagnostics(diagnostics.list())}`,
              })
              return
            }
            if (command.type === "invalid") {
              context.ui.toast.show({ message: "Use /suggest, /suggest model provider/model, /suggest model clear, /suggest debug [on|off], or /suggest log", variant: "warning" })
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
            catalog.clear()
            const route = context.ui.router.current()
            if (route.type === "session") void lifecycle.run(route.sessionID)
      })
    context.keymap.layer(acceptLayer)
    context.keymap.layer(suggestLayer)

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
