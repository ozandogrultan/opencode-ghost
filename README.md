# opencode-ghost

[![CI](https://github.com/ozandogrultan/opencode-ghost/actions/workflows/ci.yml/badge.svg)](https://github.com/ozandogrultan/opencode-ghost/actions/workflows/ci.yml)

An **OpenCode V2 TUI plugin** providing next-prompt suggestions, in the
style of Claude Code: after each turn a small model reads the recent
conversation and writes the message you would most likely send next, shown as
a dimmed inline placeholder in the empty composer with
<kbd>Tab</kbd>/<kbd>→</kbd> to accept it.

> Why "ghost": it writes the line you were about to type, then waits for you to
> take it.

## What it does

- **Suggests your next message.** After a turn finishes, it debounces, builds a
  short transcript of the recent turns, and asks a model for one line that
  sounds like you.
- **Inline empty-composer ghost.** The suggestion renders as the textarea's
  dimmed placeholder while the normal composer is empty in an idle session,
  including when unfocused. With the composer focused, `Tab` or `→` inserts it
  as editable text; Enter does not accept
  or submit the ghost. Acceptance never replaces a draft or touches the clipboard.
- **Hides as you type.** Typing and pasting abort pending generation and hide the
  preview. Emptying the composer restores the same suggestion without another
  API call; focus changes also reuse it. Navigation keys leave it intact.
- **`/suggest` toggles it.** State is stored durably via the plugin's storage.

## Requirements

- [opencode](https://opencode.ai) v2 (TUI plugins; tested against 2.0.25).
- A provider/model that supports the stateless generation endpoint, or set `model` explicitly.

## Install

### From this repo (recommended)

```sh
git clone https://github.com/ozandogrultan/opencode-ghost.git
cd opencode-ghost
./install.sh
```

Then **restart opencode** — plugins are loaded at startup only. `install.sh`
copies the plugin into `<config>/plugins/opencode-ghost/` and registers it in
`<config>/cli.json`, migrating an existing v1 `tui.json` registration (and its
options) if one is found.
Removed options (`apiKey`, `endpoint`, `internalSessionMarkerDir`, `argHints`)
are stripped from Ghost registrations. Other configuration is preserved.
The installer accepts JSON objects only; JSONC or invalid configuration is
left intact along with the installed sources and requires manual registration
using the snippet below. Node is required for the installer.

### Manually

Add the plugin to your `cli.json` (normally `~/.config/opencode/cli.json`).
For an isolated test, set `OPENCODE_CONFIG_DIR` to a separate configuration
directory containing this file; a project's `.opencode/cli.json` is not loaded.

```jsonc
{
  "plugins": ["/absolute/path/to/opencode-ghost/src"]
}
```

Pass options with the object form:

```jsonc
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-ghost/src",
       "options": { "model": "openai/gpt-6-luna-fast" }
    }
  ]
}
```

Restart opencode after changing `cli.json`.

Register a directory containing `tui.tsx`, not the file itself. For an installed
copy, use `/absolute/path/to/config/plugins/opencode-ghost`.

## Options

| Option           | Type       | Default            | Notes                                                        |
| ---------------- | ---------- | ------------------- | ------------------------------------------------------------- |
| `enabled`        | `boolean`  | `true`              | Initial state; `/suggest` toggles it at runtime (persisted).  |
| `model`          | `string`   | OpenCode small default | Explicit `provider/model` override. Otherwise uses the effective title-agent model or OpenCode's small-model selection policy. |
| `acceptKeys`     | `string[]` | `["tab", "right"]`  | Key names as reported by the terminal (`tab`, `right`, ...). Modifier aliases (`meta`, `option`, `cmd`, `control`) are normalised; unknown modifiers are ignored. |
| `maxChars`       | `number`   | `120`               | Maximum suggestion length.                                     |
| `idleDelayMs`    | `number`   | `500`               | Debounce after a turn finishes before generating.               |
| `recentMessages` | `number`   | `10`                | How many recent messages feed the suggestion prompt.            |
| `system`         | `string`   | built-in            | Override the system prompt sent to the suggestion model.        |

## Commands

- `/suggest` — toggle suggestions on/off (persisted).
- `/suggest model openai/gpt-6-luna-fast` — set a persisted runtime model override.
- `/suggest model clear` — clear the override and use the configured `model`,
  or the OpenCode small default, never the main model.
- `/suggest debug` — toggle debug mode (persisted). While on, each generation
  attempt shows a toast with its outcome, resolved model, latency and length, or
  the error.
- `/suggest debug on` / `/suggest debug off` — set debug mode explicitly.
- `/suggest log` — show the last 20 generation attempts (outcome, model,
  latency, length and error detail) in a dialog, regardless of debug mode.

Model precedence is the persisted `/suggest model` override, then the `model`
option, then the effective title agent's model from OpenCode's public agent API.
OpenCode resolves inherited `agents.title.model`, migrated legacy `small_model`,
and directory definitions such as `agents/title.md` and `agent/title.md`, including
agent deletion/recreation. Explicitly configured variants are preserved.
Without a configured title model, or when the title agent is disabled, Ghost
mirrors OpenCode 2.0.25's internal small-model policy until a public API exists:
within the session model's provider (or the session agent model's provider,
then the location's default provider, then the first enabled text model's
provider when no default exists), choose
the first enabled, active text-input/text-output catalog model in family order
`gpt-luna`, `gemini-flash-lite`, `gemini-flash`, `claude-haiku`.
Like OpenCode's title generation, an override, title or small model without a
configured variant uses its first supported `none`, `minimal` or `low` variant.
Catalog IDs are used directly. The model catalog is cached for five minutes
(cleared by `/suggest model` and re-enabling, and refetched once before reporting
no small model); the agent list is read on every generation. No matching small
model means a warning and no suggestion. Ghost never uses the main model as a generation fallback or retries
with another provider. An explicit override or configured title model may use
a different provider from the session's primary model.

When enabling, a suggestion is generated immediately for the current session.

## How it works

- Listens for `session.execution.succeeded`, debounces, and builds a short
  transcript from the session's recent messages.
- Generates the suggestion statelessly through OpenCode's `generate.text` API —
  no session is created, and the call is cancelled if a newer turn finishes,
  the session is left, suggestions are disabled, or the plugin unloads.
- A zero-size prompt-footer marker identifies the normal composer through the
  public renderer tree. The textarea's public placeholder setter displays the
  suggestion without changing its buffer, caret, history or undo state.
- Solid effects and a public pre-render callback synchronize placeholder
  ownership. Host hint/color updates are retained while the ghost is visible;
  dismissal restores only values still owned by Ghost, including rich hints.
- Accepting uses the composer editor's `insertText` directly, without submitting.
- Typing, pasting, navigation, a new execution, disabling and unloading cancel
  pending generation. Duplicate completion events do not generate again.
- Retains only one suggestion, bounded by `maxChars`, for the visible session.
  Acceptance, a new turn, session changes, disabling, model changes and unloading
  discard it.

## Debugging

Ghost records every generation attempt to a bounded in-memory history (the last
20): outcome (`ok`, `empty`, `echo`, `no model`, `error`, `aborted`), the resolved
model with its variant, latency, suggestion length and error detail. `/suggest log`
shows it in a dialog at any time; `aborted` covers attempts cancelled by typing,
a newer turn, leaving the session, disabling or unload, so a missing suggestion can
be traced to a debounce, an empty or `NONE` reply, an echo filter, or a provider
error. `/suggest debug` toggles the same data as a toast on each attempt (aborts
are logged but not toasted). The history is not written to disk.

When a generation is `ok` but nothing is visible, `/suggest log` also shows the
live display state and a bounded history of display changes. Each `shown` or
`hidden` entry names the reason the placeholder is not applied: no
`prompt.footer` marker, an unidentified or ambiguous editor, a non-normal prompt or keymap mode, a draft, selection, extmarks,
a busy or hidden session, or the host overriding the placeholder. The live
section also reports focus, keymap mode and the placeholder colour. With
`/suggest debug` on, each change is toasted.

## Caveats

- **No inline typing completions.** V1's slash-argument and history ghosts
  are not supported. This ghost is a next-prompt placeholder for an empty
  composer, not a completion after typed text.
- **Focus safety.** Modal/form and shell editors are never acceptance targets.
  Non-base keymap modes, autocomplete capture, renderer/editor selections and
  composer extmarks suppress the ghost. The layout around the textarea is not
  inspected, so it works across host layouts.
- **Attachment visibility.** V2 does not expose draft attachments to plugins.
  Attachments without an extmark (image previews, non-image files) cannot be
  detected, so a ghost may appear in those drafts. Disable suggestions with
  `/suggest` when using such attachments.
- **Renderer integration.** Composer discovery depends on the host renderer
  hierarchy and its composer identity guard. Placeholder synchronization uses
  OpenTUI's public pre-render callback; host renderer changes need re-verification.
- **Key fallthrough.** Without an eligible ghost, Tab/Right fall through to
  the host. OpenCode V2's default agent-cycle shortcut is Shift+Tab.
- **Cost.** One model call per turn while enabled. Point `model` at a cheap or
  free model.
- **Provider compatibility.** OpenAI and google-vertex generation worked in
  verification. Anthropic's stateless endpoint failed with plugin-auth OAuth
  in verification; choose a supported provider/model. Luna 6.1 is not available.
- Generation errors show one warning toast per plugin load with the model
  override command. Aborts and `NONE` replies produce no warning or preview.
- Effective agents and catalogs are read per generation for the session's
  location. The stateless endpoint has no location argument; project-only models
  may fail server-global resolution. Invalid overrides and provider failures warn
  without retrying through another provider or a session.

## Development

```sh
bun install
bun run typecheck
bun run test
```

No build step: like other opencode TUI plugins, the package ships TSX source and
opencode's runtime transpiles it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the check suite and commit
conventions, [AGENTS.md](AGENTS.md) for the design rules, and
[CHANGELOG.md](CHANGELOG.md) for what changed.

## License

MIT
