/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { resolveOptions, type PromptSuggestOptions } from "./options"
import { clip, normalize, parseModel } from "./text"

const HIDDEN_TITLE = "ghost-hidden"
const MAX_MESSAGE_CHARS = 800
const MAX_TRANSCRIPT_CHARS = 6000
const ENABLED_KEY = "ghost.enabled"
const MODEL_KEY = "ghost.model"

const HIDDEN_TOOLS = {
  bash: false,
  edit: false,
  write: false,
  read: false,
  grep: false,
  glob: false,
  list: false,
  task: false,
  todowrite: false,
  todoread: false,
  webfetch: false,
  websearch: false,
  patch: false,
  multiedit: false,
  question: false,
  skill: false,
  lsp: false,
}

const tui: TuiPlugin = async (api, rawOptions) => {
  const opts = resolveOptions(rawOptions as PromptSuggestOptions | undefined)
  const [ghost, setGhost] = createSignal<{ sessionID: string; text: string } | undefined>()
  let promptRef: TuiPromptRef | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let generating = false
  let acceptLayer: (() => void) | undefined

  const currentSessionID = () => {
    const route = api.route.current
    if (route.name !== "session") return undefined
    const id = route.params?.sessionID
    return typeof id === "string" ? id : undefined
  }

  const currentInput = () => promptRef?.current.input ?? ""

  const isEnabled = () => {
    try {
      return api.kv.get<boolean>(ENABLED_KEY, opts.enabled) !== false
    } catch {
      return opts.enabled
    }
  }

  const setEnabled = (value: boolean) => {
    try {
      api.kv.set(ENABLED_KEY, value)
    } catch {
      // ignore
    }
  }

  const resolveModel = () => {
    try {
      const override = api.kv.get<string>(MODEL_KEY)
      if (typeof override === "string" && override.trim()) return parseModel(override.trim())
    } catch {
      // ignore
    }
    return (
      parseModel(opts.model) ??
      parseModel(api.state.config.small_model) ??
      parseModel(api.state.config.model)
    )
  }

  const buildTranscript = (sessionID: string) => {
    const messages = api.state.session.messages(sessionID)
    const lines: string[] = []
    for (const message of messages.slice(-opts.recentMessages)) {
      if (message.role !== "user" && message.role !== "assistant") continue
      const text = api.state
        .part(message.id)
        .filter((part) => part.type === "text")
        .map((part) => (part.type === "text" ? part.text : ""))
        .join(" ")
      if (!text.trim()) continue
      lines.push(
        `${message.role === "user" ? "User" : "Assistant"}: ${clip(text, MAX_MESSAGE_CHARS)}`,
      )
    }
    if (lines.length === 0) return ""
    return `${lines.join("\n").slice(-MAX_TRANSCRIPT_CHARS)}\n\nTask: write the user's next message.`
  }

  const generate = async (sessionID: string): Promise<string | undefined> => {
    const transcript = buildTranscript(sessionID)
    if (!transcript) return undefined

    const created = await api.client.session.create({ title: HIDDEN_TITLE })
    const tempID = created.data?.id
    if (!tempID) return undefined

    try {
      const result = await api.client.session.prompt({
        sessionID: tempID,
        system: opts.system,
        tools: { ...HIDDEN_TOOLS },
        model: resolveModel(),
        parts: [{ type: "text", text: transcript }],
      })
      const parts = result.data?.parts ?? []
      const raw = parts
        .filter((part) => part.type === "text")
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n")
      return normalize(raw, opts.maxChars)
    } finally {
      await api.client.session.delete({ sessionID: tempID }).catch(() => undefined)
    }
  }

  const enableAccept = () => {
    if (acceptLayer) return
    acceptLayer = api.keymap.registerLayer({
      mode: "base",
      priority: 100,
      bindings: opts.acceptKeys.map((key) => ({
        key,
        desc: "Accept suggested prompt",
        preventDefault: true,
        cmd: () => {
          accept()
          return true
        },
      })),
    })
  }

  const disableAccept = () => {
    acceptLayer?.()
    acceptLayer = undefined
  }

  const showGhost = (value: { sessionID: string; text: string } | undefined) => {
    setGhost(value)
    if (value) enableAccept()
    else disableAccept()
  }

  const run = async (sessionID: string) => {
    if (generating) return
    if (!isEnabled()) return
    if (currentSessionID() !== sessionID) return
    if (currentInput().trim()) return
    generating = true
    try {
      const text = await generate(sessionID)
      if (currentSessionID() !== sessionID) return
      if (currentInput().trim()) return
      if (!isEnabled()) return
      showGhost(text ? { sessionID, text } : undefined)
    } catch {
      // ignore background failures
    } finally {
      generating = false
    }
  }

  const schedule = (sessionID: string) => {
    if (!isEnabled()) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void run(sessionID), opts.idleDelayMs)
  }

  const accept = () => {
    const current = ghost()
    if (!current) return false
    if (currentSessionID() !== current.sessionID) {
      showGhost(undefined)
      return false
    }
    if (!promptRef) return false
    if (currentInput().trim()) return false
    promptRef.set({ input: current.text, parts: [] })
    promptRef.focus()
    showGhost(undefined)
    return true
  }

  const offIdle = api.event.on("session.idle", (event) => {
    const id = event.properties?.sessionID
    if (!id) return
    schedule(id)
  })

  api.slots.register({
    order: 60,
    slots: {
      session_prompt(_ctx, props) {
        const suggestion = () => {
          const current = ghost()
          return current && current.sessionID === props.session_id ? current.text : ""
        }
        return (
          <api.ui.Prompt
            sessionID={props.session_id}
            visible={props.visible}
            disabled={props.disabled}
            showPlaceholder={false}
            hint={
              suggestion() ? (
                <box marginLeft={1}>
                  <text fg={api.theme.current.textMuted}>{suggestion()}</text>
                </box>
              ) : undefined
            }
            right={<api.ui.Slot name="session_prompt_right" session_id={props.session_id} />}
            onSubmit={() => {
              showGhost(undefined)
              props.on_submit?.()
            }}
            ref={(ref) => {
              promptRef = ref
              props.ref?.(ref)
            }}
          />
        )
      },
    },
  })

  api.command?.register(() => [
    {
      title: `Prompt suggestions: ${isEnabled() ? "on" : "off"}`,
      value: "ghost",
      description: "Toggle the suggested next prompt",
      category: "Prompt",
      slash: { name: "suggest" },
      onSelect: async () => {
        const next = !isEnabled()
        setEnabled(next)
        if (!next) {
          showGhost(undefined)
          api.ui.toast({ title: "Prompt suggestions", message: "Off" })
          return
        }
        api.ui.toast({ title: "Prompt suggestions", message: "On" })
        const sessionID = currentSessionID()
        if (!sessionID) return
        try {
          const text = await generate(sessionID)
          showGhost(text ? { sessionID, text } : undefined)
        } catch {
          // ignore
        }
      },
    },
  ])

  api.lifecycle.onDispose(() => {
    if (timer) clearTimeout(timer)
    offIdle()
    disableAccept()
  })
}

export default {
  id: "ghost",
  tui,
}
