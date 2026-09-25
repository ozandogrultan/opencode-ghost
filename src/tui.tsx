/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import * as fs from "node:fs"
import * as path from "node:path"
import { resolveOptions, type PromptSuggestOptions } from "./options"
import { clip, isEcho, normalize, parseModel } from "./text"
import { BUILTIN_COMMANDS } from "./builtins"
import { completeCommand, type CommandPool } from "./completion"

const HIDDEN_TITLE = "ghost-hidden"
// Survives the server's automatic title generation, which renames the hidden
// session after the first prompt and would otherwise make it invisible to a
// title-based sweep.
const GHOST_METADATA = { ghost: "opencode-ghost" } as const
const ORPHAN_SWEEP_INTERVAL_MS = 30_000
const ORPHAN_MIN_AGE_MS = 15_000
const MAX_MESSAGE_CHARS = 800
const MAX_TRANSCRIPT_CHARS = 6000
const ENABLED_KEY = "ghost.enabled"
const MODEL_KEY = "ghost.model"
const GHOST_DEBUG = Boolean(process.env.GHOST_DEBUG)

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

function markSession(dir: string, pending: string, id: string, directory: string | undefined) {
  try {
    fs.writeFileSync(
      path.join(dir, `id-${id}`),
      JSON.stringify(directory ? { directory, pid: process.pid } : { pid: process.pid }),
    )
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

function isGhostSession(session: { title?: unknown; metadata?: unknown }): boolean {
  if ((session as { title?: unknown }).title === HIDDEN_TITLE) return true
  const metadata = (session as { metadata?: Record<string, unknown> }).metadata
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).ghost === GHOST_METADATA.ghost
  )
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
  // In-flight hidden sessions (id -> directory). A Map so dispose and the
  // sweep can scope get/delete calls even while a generation is running.
  const activeHidden = new Map<string, string | undefined>()

  // Directory of the visible session the suggestion belongs to, falling back
  // to the TUI working directory. Every hidden-session call is scoped with it:
  // the server resolves sessions per directory, and an unscoped call is the
  // historical reason failed generations left sessions behind.
  const resolveParentDirectory = (visibleSessionID: string): string | undefined => {
    try {
      const local = api.state.session.get(visibleSessionID) as { directory?: unknown } | undefined
      if (typeof local?.directory === "string" && local.directory) return local.directory
    } catch {
      // fall through to the cwd
    }
    try {
      const cwd = (api.state as { path?: { directory?: unknown } }).path?.directory
      if (typeof cwd === "string" && cwd) return cwd
    } catch {
      // unavailable in some test harnesses; callers fall back to the
      // server-reported directory instead.
    }
    return undefined
  }

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

  // Reaps abandoned ghost sessions in this process and from crashed ones. Two
  // phases:
  //
  // - Marker files (when `internalSessionMarkerDir` is configured) are
  //   authoritative proof this plugin created the session, so they are deleted
  //   regardless of title: the server auto-titles the hidden session after the
  //   first prompt, and the old title check let every retitled orphan live
  //   forever. It deliberately does not skip markers by owner pid anymore: a
  //   failed delete in a still-running TUI left its own markers behind forever,
  //   because the old startup-only recovery treated a live pid as
  //   "not orphaned". Fresh markers (younger than ORPHAN_MIN_AGE_MS) whose
  //   owner is still running are left alone so an in-flight generation in
  //   another process is not swept mid-write.
  // - A list-based sweep needs no configuration and catches everything the
  //   markers miss (default setup, older versions, deleted marker dirs). Only
  //   sessions still identifiable as ghost (title or metadata tag) and quiet
  //   past the grace window are deleted, and never in-flight generations of
  //   this process.
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

      if (await removeHiddenSession(sessionID, directory)) {
        try {
          fs.rmSync(marker, { force: true })
        } catch {
          // best effort
        }
      }
    }

    try {
      const listed = await api.client.session.list()
      const sessions = (listed as { data?: unknown }).data
      if (!Array.isArray(sessions)) return
      const now = Date.now()
      for (const session of sessions) {
        const candidate = session as {
          id?: unknown
          title?: unknown
          metadata?: unknown
          directory?: unknown
          time?: { created?: unknown; updated?: unknown }
        }
        if (typeof candidate.id !== "string" || !candidate.id) continue
        if (activeHidden.has(candidate.id)) continue
        if (!isGhostSession(candidate)) continue
        const updated =
          typeof candidate.time?.updated === "number"
            ? candidate.time.updated
            : typeof candidate.time?.created === "number"
              ? candidate.time.created
              : undefined
        if (updated !== undefined && now - updated < ORPHAN_MIN_AGE_MS) continue
        const directory =
          typeof candidate.directory === "string" && candidate.directory
            ? candidate.directory
            : undefined
        await removeHiddenSession(candidate.id, directory)
      }
    } catch {
      // Listing is best effort (server down, older SDK): markers and the
      // generation finally-block still cover the common cases.
    }
  }
  void sweepOrphans()
  const sweepTimer = setInterval(() => void sweepOrphans(), ORPHAN_SWEEP_INTERVAL_MS)
  sweepTimer.unref?.()

  const [ghost, setGhost] = createSignal<{ sessionID: string; text: string } | undefined>()
  const [completion, setCompletion] = createSignal<
    { sessionID: string; display: string; insert?: string; drawn: boolean } | undefined
  >()
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

  // Completable commands: configured commands/skills from the server layered
  // under the builtin TUI slash commands. One config read, refreshed lazily; no
  // model calls are involved anywhere in completion.
  let commandPool: CommandPool[] = BUILTIN_COMMANDS
  let poolFetching = false
  let poolFetchedAt = 0
  const refreshPool = async () => {
    if (poolFetching) return
    poolFetching = true
    try {
      const result = await api.client.command.list()
      const rows = (result as { data?: unknown }).data
      if (Array.isArray(rows)) {
        const configured: CommandPool[] = rows
          .map((row) => row as { name?: unknown; description?: unknown })
          .filter((row) => typeof row.name === "string" && row.name.length > 0)
          .map((row) => ({
            name: row.name as string,
            description: typeof row.description === "string" ? row.description : undefined,
          }))
        const seen = new Set(configured.map((command) => `${command.name.toLowerCase()}`))
        const merged = [
          ...configured,
          ...BUILTIN_COMMANDS.filter((command) => !seen.has(command.name.toLowerCase())),
        ]
        commandPool = merged.length > 0 ? merged : BUILTIN_COMMANDS
        poolFetchedAt = Date.now()
      }
    } catch {
      // Keep the current pool; the poll loop retries on the next TTL window.
    } finally {
      poolFetching = false
    }
  }
  void refreshPool()

  // History ghost while typing: if the input is a prefix of a message the user
  // already sent in this session, offer the rest of it. No model involved.
  const historyCandidate = (sessionID: string, input: string) => {
    const wants = input.replace(/\s+/g, " ").trimEnd()
    if (wants.length < 2 || /\n/.test(input)) return undefined
    const collapsed = wants.toLowerCase()
    const messages = api.state.session.messages(sessionID).filter((m) => m.role === "user")
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = api.state
        .part(messages[i].id)
        .filter((part) => part.type === "text")
        .map((part) => (part.type === "text" ? part.text : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
      if (text.length <= collapsed.length) continue
      if (!text.toLowerCase().startsWith(collapsed)) continue
      return { ghost: text.slice(collapsed.length), insert: text }
    }
    return undefined
  }

  // In-box ghost: an absolutely positioned text node rendered in the slot's
  // own container, at the caret of the prompt's editor renderable (found by
  // walking the layout tree). Uses the normal render pipeline, so it is visible
  // wherever the prompt is. When the editor or container cannot be located
  // (host layout change) completion falls back to the hint row.
  const [inBox, setInBox] = createSignal<
    { sessionID: string; x: number; y: number; text: string } | undefined
  >()
  let slotNode: { screenX?: number; screenY?: number } | undefined
  // Locate the prompt's editor renderable inside the layout tree.
  const findTextarea = (): unknown => {
    const root = (api.renderer as unknown as { root?: unknown }).root as
      | { getChildren?: () => unknown[] }
      | undefined
    if (!root) return undefined
    const stack: unknown[] = [root]
    while (stack.length) {
      const node = stack.pop() as
        | {
            editBuffer?: unknown
            editorView?: unknown
            visualCursor?: { visualRow?: number; visualCol?: number }
            screenX?: number
            screenY?: number
            getChildren?: () => unknown[]
          }
        | undefined
      if (!node) continue
      if (node.editBuffer && node.editorView && node.visualCursor) return node
      const children = typeof node.getChildren === "function" ? node.getChildren() : []
      stack.push(...children)
    }
    return undefined
  }

  const placeInBoxGhost = (sessionID: string, text: string): boolean => {
    setInBox(undefined)
    const textarea = findTextarea() as
      | { screenX?: unknown; screenY?: unknown; visualCursor?: { visualRow?: number; visualCol?: number } }
      | undefined
    if (
      !textarea ||
      typeof textarea.screenX !== "number" ||
      typeof textarea.screenY !== "number"
    ) {
      return false
    }
    const cursor = textarea.visualCursor ?? {}
    // The overlay box is positioned against the root (absolute), so use the
    // editor's screen coordinates plus the caret's visual column/row.
    const x = textarea.screenX + (typeof cursor.visualCol === "number" ? cursor.visualCol : 0)
    const y = textarea.screenY + (typeof cursor.visualRow === "number" ? cursor.visualRow : 0)
    setInBox({ sessionID, x, y, text })
    return true
  }

  const POLL_INTERVAL_MS = 100
  const POOL_TTL_MS = 60_000
  let completionKey = ""
    const pollTimer = setInterval(() => {
    const sessionID = currentSessionID()
    if (!sessionID) {
      if (completion() || inBox()) {
        setCompletion(undefined)
        setInBox(undefined)
      }
      return
    }
    const input = promptRef?.current.input ?? ""
    if (poolFetchedAt && Date.now() - poolFetchedAt > POOL_TTL_MS) void refreshPool()
    // `/name` with no space yet is opencode's native slash menu; the plugin
    // stays out of its way. Our slash completion only covers `/name args...`.
    const found = !input.startsWith("/")
      ? historyCandidate(sessionID, input)
      : input.includes(" ")
        ? completeCommand(input, commandPool, opts.argHints)
        : undefined
    const key = `${sessionID}\u0000${input}`
    const insert = found?.insert ?? ""
    if (completionKey === `${key}\u0000${insert}`) return
    completionKey = `${key}\u0000${insert}`
    let display = ""
    if (found) {
      const args = "args" in found ? found.args : undefined
      const hint = "hint" in found ? found.hint : undefined
      display = args && args.length > 0 ? `[${args.join(" | ")}]` : (found.ghost ?? hint ?? "")
    }
    const drawn = display ? placeInBoxGhost(sessionID, display) : false
    if (!display) setInBox(undefined)
    if (GHOST_DEBUG && (display || input.startsWith("/"))) {
      const overlay = inBox()
      try {
        api.ui.toast({
          title: "ghost-debug",
          message: `display=${display.slice(0, 20) || "∅"} drawn=${drawn} slot=${slotNode ? `${slotNode.screenX}/${slotNode.screenY}` : "n"} ta=${findTextarea() ? "y" : "n"} box=${overlay ? `${overlay.x}/${overlay.y}` : "∅"}`,
        })
      } catch {
        // ignore
      }
    }
    setCompletion(
      found
        ? {
            sessionID,
            display,
            insert,
            drawn,
          }
        : undefined,
    )
    setAcceptVisible(Boolean(insert) || Boolean(ghost()))
  }, POLL_INTERVAL_MS)
  pollTimer.unref?.()

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
    // Scope every hidden-session call to the visible session's project: the
    // server resolves sessions per directory, and unscoped calls left orphans
    // behind whenever the default differed.
    const parentDirectory = resolveParentDirectory(sessionID)
    try {
      const created = await api.client.session.create({
        title: HIDDEN_TITLE,
        metadata: { ...GHOST_METADATA },
        ...(parentDirectory ? { directory: parentDirectory } : {}),
      })
      tempID = created.data?.id
      if (!tempID) return undefined
      createdDirectory =
        typeof created.data?.directory === "string" && created.data.directory
          ? created.data.directory
          : parentDirectory
      activeHidden.set(tempID, createdDirectory)
      if (markerDir && pending)
        markSession(markerDir, pending, tempID, createdDirectory ?? parentDirectory ?? "")

      const result = await api.client.session.prompt({
        sessionID: tempID,
        ...(createdDirectory ? { directory: createdDirectory } : {}),
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
        desc: "Accept suggested prompt or completion",
        preventDefault: true,
        cmd: () => {
          if (completionAccept()) return true
          return accept()
        },
      })),
    })
  }

  const disableAccept = () => {
    acceptLayer?.()
    acceptLayer = undefined
  }

  let acceptVisible = false
  const setAcceptVisible = (value: boolean) => {
    if (acceptVisible === value) return
    acceptVisible = value
    if (value) enableAccept()
    else disableAccept()
  }

  const showGhost = (value: { sessionID: string; text: string } | undefined) => {
    setGhost(value)
    setAcceptVisible(Boolean(value) || Boolean(completion()?.insert))
  }

  const completionAccept = () => {
    const current = completion()
    if (!current || currentSessionID() !== current.sessionID) return false
    if (!promptRef || !current.insert) return false
    completionKey = ""
    promptRef.set({ input: current.insert, parts: [] })
    promptRef.focus()
    setCompletion(undefined)
    return true
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
        const completionText = () => {
          const current = completion()
          if (!current || current.sessionID !== props.session_id) return ""
          // In in-box mode the overlay text element handles the text; the hint
          // row then stays free.
          if (current.drawn) return ""
          return current.display
        }
        const overlay = () => {
          const current = inBox()
          return current && current.sessionID === props.session_id ? current : undefined
        }
        return (
          <box
            position="relative"
            ref={(ref: { screenX?: number; screenY?: number }) => {
              slotNode = ref
            }}
          >
            <api.ui.Prompt
              sessionID={props.session_id}
              visible={props.visible}
              disabled={props.disabled}
              showPlaceholder={false}
              hint={
                suggestion() || completionText() ? (
                  <box marginLeft={1}>
                    <text fg={api.theme.current.textMuted}>
                      {completionText() || suggestion()}
                    </text>
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
            {overlay() ? (
              <box position="absolute" left={overlay()!.x} top={overlay()!.y}>
                <text fg={api.theme.current.textMuted}>{overlay()!.text}</text>
              </box>
            ) : undefined}
          </box>
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
    clearInterval(pollTimer)
    setInBox(undefined)
    offIdle()
    offStatus()
    backLayer()
    disableAccept()
    // A generation in flight at shutdown would otherwise leak its hidden
    // session: the finally-block still runs for the awaiting caller, but if
    // the host drops pending work, fire one last scoped delete per session.
    // The periodic sweep (markers + list) retries anything this misses.
    for (const [sessionID, directory] of activeHidden) {
      void removeHiddenSession(sessionID, directory).catch(() => {})
    }
    activeHidden.clear()
  })
}

export default {
  id: "ghost",
  tui,
}
