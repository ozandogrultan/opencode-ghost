/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import * as fs from "node:fs"
import * as path from "node:path"
import { resolveOptions, type PromptSuggestOptions } from "./options"
import { clip, isEcho, normalize, parseModel } from "./text"

const HIDDEN_TITLE = "ghost-hidden"
const ORPHAN_SWEEP_INTERVAL_MS = 30_000
const ORPHAN_MIN_AGE_MS = 15_000
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

function markPending(dir: string, pending: string) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(pending, "")
  } catch {
    // best effort
  }
}

function markSession(dir: string, pending: string, id: string, directory: string) {
  try {
    fs.writeFileSync(path.join(dir, `id-${id}`), JSON.stringify({ directory, pid: process.pid }))
    fs.rmSync(pending, { force: true })
  } catch {
    // best effort
  }
}

function unmarkSession(dir: string, pending: string, id: string | undefined, deleted: boolean) {
  try {
    fs.rmSync(pending, { force: true })
  } catch {
    // best effort
  }
  if (!id || !deleted) return
  try {
    fs.rmSync(path.join(dir, `id-${id}`), { force: true })
  } catch {
    // best effort
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { status?: number; response?: { status?: number }; message?: string }
  const status = candidate?.status ?? candidate?.response?.status
  if (status === 404) return true
  return typeof candidate?.message === "string" && /not found/i.test(candidate.message)
}

const tui: TuiPlugin = async (api, rawOptions) => {
  const opts = resolveOptions(rawOptions as PromptSuggestOptions | undefined)
  const activeHidden = new Set<string>()

  const markerPaths = () => {
    const dir = opts.internalSessionMarkerDir
    if (!dir) return [] as { entry: string; marker: string; ageMs: number }[]
    let names: string[]
    try {
      names = fs.readdirSync(dir).filter((entry) => /^id-ses_[\w-]+$/.test(entry))
    } catch {
      return [] as { entry: string; marker: string; ageMs: number }[]
    }
    const now = Date.now()
    return names.map((entry) => {
      const marker = path.join(dir, entry)
      let ageMs = Number.POSITIVE_INFINITY
      try {
        ageMs = now - fs.statSync(marker).mtimeMs
      } catch {
        // Unreadable mtime: treat as old so it gets swept.
      }
      return { entry, marker, ageMs }
    })
  }

  // Deletes a ghost session and reports whether it is confirmed gone. A
  // `directory` is passed whenever known: the server scopes deletion by it, and
  // omitting it is why failed generations left sessions behind. A non-true
  // delete response is re-checked by existence rather than assumed to have
  // failed, so a session already removed (or removed concurrently) still counts
  // as gone and its marker is not kept forever.
  const removeHiddenSession = async (sessionID: string, directory?: string): Promise<boolean> => {
    const target = directory ? { sessionID, directory } : { sessionID }
    try {
      const result = await api.client.session.delete(target)
      if (result.data === true) return true
    } catch (error) {
      // Only a definitive "not found" means it is gone; anything else (server
      // down, permissions) must keep the marker so a later sweep retries.
      return isNotFound(error)
    }
    try {
      await api.client.session.get(target)
      return false
    } catch (error) {
      return isNotFound(error)
    }
  }

  // Reaps abandoned ghost sessions in this process and from crashed ones. It
  // deliberately does not skip markers by owner pid anymore: a failed delete in
  // a still-running TUI left its own markers behind forever, because the old
  // startup-only recovery treated a live pid as "not orphaned". Fresh markers
  // (younger than ORPHAN_MIN_AGE_MS) are left alone so an in-flight generation
  // in another process is not swept mid-write.
  const sweepOrphans = async () => {
    for (const { entry, marker, ageMs } of markerPaths()) {
      const sessionID = entry.slice(3)
      if (activeHidden.has(sessionID)) continue
      let directory: string | undefined
      let pid: number | undefined
      try {
        const parsed = JSON.parse(fs.readFileSync(marker, "utf8")) as {
          directory?: string
          pid?: number
        }
        if (typeof parsed?.directory === "string" && parsed.directory) directory = parsed.directory
        if (Number.isInteger(parsed?.pid) && (parsed.pid as number) > 0) pid = parsed.pid as number
      } catch {
        // Corrupt/empty marker: no directory or pid; still attempt cleanup.
      }
      // A fresh marker whose owner is still running may be an in-flight
      // generation in another TUI. A dead owner, or one quiet past the grace
      // window, is an orphan.
      if (pid !== undefined && ageMs < ORPHAN_MIN_AGE_MS && processIsRunning(pid)) continue

      let title: string | undefined
      try {
        const found = await api.client.session.get(directory ? { sessionID, directory } : { sessionID })
        title = found.data?.title
      } catch {
        title = undefined
      }
      // Never delete a session we can still identify as non-ghost.
      if (title !== undefined && title !== HIDDEN_TITLE) continue

      if (await removeHiddenSession(sessionID, directory)) {
        try {
          fs.rmSync(marker, { force: true })
        } catch {
          // best effort
        }
      }
    }
  }
  void sweepOrphans()
  const sweepTimer = setInterval(() => void sweepOrphans(), ORPHAN_SWEEP_INTERVAL_MS)
  sweepTimer.unref?.()

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

  const lastUserText = (sessionID: string) => {
    const message = api.state.session.messages(sessionID).filter((m) => m.role === "user").at(-1)
    if (!message) return ""
    return api.state
      .part(message.id)
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ")
  }

  const generate = async (sessionID: string): Promise<string | undefined> => {
    const transcript = buildTranscript(sessionID)
    if (!transcript) return undefined

    const markerDir = opts.internalSessionMarkerDir
    const pending = markerDir ? path.join(markerDir, "pending") : undefined
    if (markerDir && pending) markPending(markerDir, pending)

    let tempID: string | undefined
    let createdDirectory: string | undefined
    try {
      const created = await api.client.session.create({ title: HIDDEN_TITLE })
      tempID = created.data?.id
      if (!tempID) return undefined
      createdDirectory = created.data?.directory
      activeHidden.add(tempID)
      if (markerDir && pending) markSession(markerDir, pending, tempID, created.data!.directory)

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
      const suggestion = normalize(raw, opts.maxChars)
      if (!suggestion) return undefined
      const previous = lastUserText(sessionID)
      if (previous && isEcho(suggestion, previous)) return undefined
      return suggestion
    } finally {
      let deleted = false
      if (tempID) {
        activeHidden.delete(tempID)
        // Pass the directory and retry-based confirmation so a failed
        // generation still removes its hidden session. If the session truly
        // cannot be removed yet, the marker is kept and sweepOrphans retries.
        deleted = await removeHiddenSession(tempID, createdDirectory)
      }
      if (markerDir && pending) unmarkSession(markerDir, pending, tempID, deleted)
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

  // session.idle is deprecated upstream; the live signal is session.status.
  const offStatus = api.event.on("session.status", (event) => {
    const props = event.properties
    if (props?.status?.type !== "idle") return
    if (!props.sessionID) return
    schedule(props.sessionID)
  })

  const backLayer = api.keymap.registerLayer({
    mode: "base",
    priority: 40,
    bindings: [
      {
        key: "left",
        desc: "Return to the home screen when the prompt is empty",
        preventDefault: false,
        fallthrough: true,
        cmd: () => {
          if (!opts.backOnEmptyLeft) return false
          if (api.route.current.name !== "session") return false
          if (!promptRef) return false
          if (currentInput().trim().length > 0) return false
          api.route.navigate("home")
          return true
        },
      },
    ],
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
    clearInterval(sweepTimer)
    offIdle()
    offStatus()
    backLayer()
    disableAccept()
  })
}

export default {
  id: "ghost",
  tui,
}
