# opencode-ghost

[![CI](https://github.com/ozandogrultan/opencode-ghost/actions/workflows/ci.yml/badge.svg)](https://github.com/ozandogrultan/opencode-ghost/actions/workflows/ci.yml)

**Next-prompt suggestions** for the [opencode](https://opencode.ai) TUI, in the
style of Claude Code: after each turn a small model reads the recent
conversation and writes the message you would most likely send next, shown as
dimmed ghost text you accept with <kbd>Tab</kbd> (or <kbd>→</kbd>).

> Why "ghost": it writes the line you were about to type, then waits for you to
> take it.

## What it does

- **Suggests your next message.** On `session.idle` it debounces, builds a short
  transcript of the recent turns, and asks a model (your `small_model` by
  default) for one line that sounds like you.
- **Ghost text, `Tab` to accept.** The suggestion renders under the prompt;
  `Tab` or `→` drops it into the input so you can edit and send.
- **Slash-command argument ghosts while typing.** After `/name `, the accepted
  argument options (from `argHints`) are listed as `[a | b | c]` inside the
  prompt input box, right after the caret. Once you start typing an argument,
  the list gives way to a dimmed inline completion of the matching option (e.g.
  `/keepwarm alw` ghosts `ays`). Running out of options or naming a command
  with no configured hints shows no ghost — command and skill descriptions are
  never suggested as if they were arguments. Tab completes the next argument.
  While the command name is still being typed, opencode's own slash menu stays
  in charge. Purely local — no model calls.
- **History ghost while typing.** If the line you are typing is a prefix of a
  message you already sent in the same session, the rest of it is ghosted in
  the box as well; Tab pulls the full line back. Also purely local.
- **Grey, dimmed ghost styling.** Every ghost is grey and dimmed so it cannot
  be mistaken for typed text. A next-message suggestion that is wider than the
  prompt wraps onto extra rows and grows the prompt box (up to five rows) so it
  stays fully readable; other ghosts are clipped to the box and never spill
  past it.
- **`/suggest` toggles it.** State is stored in the plugin KV.

## Requirements

- [opencode](https://opencode.ai) (TUI plugins; tested on 1.18.x).
- A cheap/fast model for `small_model` — or set `model` explicitly.

## Install

### From this repo (recommended)

```sh
git clone https://github.com/ozandogrultan/opencode-ghost.git
cd opencode-ghost
./install.sh
```

Then **restart opencode** — plugins are loaded at startup only. `install.sh`
copies the plugin into `<config>/plugins/opencode-ghost/` and registers it in
`<config>/tui.json` (backing the file up first).

### Manually

Add the checkout to your `tui.json` (global at `~/.config/opencode/tui.json`, or
a project's `.opencode/`). Plugins are loaded as source:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-ghost/src/tui.tsx"],
}
```

### From npm

```sh
opencode plugin opencode-ghost       # current project
opencode plugin -g opencode-ghost    # global
```

Restart opencode after changing `tui.json`.

## Options

Pass an options object as the second element of the plugin tuple:

```jsonc
{
  "plugin": [
    ["opencode-ghost", {
      "enabled": true,
      "model": "anthropic/claude-haiku-4-5",
      "acceptKeys": ["tab", "right"],
      "maxChars": 120,
      "idleDelayMs": 500,
      "recentMessages": 10
    }]
  ]
}
```

| Option           | Type       | Default               | Notes                                                                 |
| ---------------- | ---------- | --------------------- | --------------------------------------------------------------------- |
| `enabled`        | `boolean`  | `true`                | Initial state; `/suggest` toggles it at runtime (persisted).          |
| `model`          | `string`   | session `small_model` | `provider/model`. Falls back to `small_model`, then the session model. |
| `acceptKeys`     | `string[]` | `["tab", "right"]`    | Key names as reported by the terminal (`tab`, `right`, ...).          |
| `maxChars`       | `number`   | `120`                 | Maximum suggestion length.                                            |
| `idleDelayMs`    | `number`   | `500`                 | Debounce after a turn finishes before generating.                     |
| `recentMessages` | `number`   | `10`                  | How many recent messages feed the suggestion prompt.                  |
| `system`         | `string`   | built-in              | Override the system prompt sent to the suggestion model.              |
| `backOnEmptyLeft` | `boolean`  | `false`               | Return to the home screen with Left when the prompt is empty.         |
| `internalSessionMarkerDir` | `string` | unset       | Optional extra crash-recovery tracking. A configuration-free sweep already reaps leftover hidden sessions, so this is only an additional safety net. |
| `argHints` | `Record<string, string[]>` | `{}` | Argument option lists per slash command, shown as `[a \| b \| c]` after a complete `/name ` and completed with Tab, e.g. `"/keepwarm": ["6h", "always", "off", "status"]`. Commands without an entry suggest no arguments. |

## Commands

- `/suggest` — toggle suggestions on/off (state is stored in the plugin KV).

When enabling, a suggestion is generated immediately for the current session.

## How it works

- Listens for `session.idle`, debounces, and builds a short transcript from the
  session's recent messages.
- Asks a model (your `small_model` by default) for one short next user message,
  in a throwaway hidden session with tools disabled; the session is deleted
  immediately afterwards. Every hidden-session call is scoped to the current
  session's project directory, hidden sessions carry a metadata tag that
  survives the server's automatic title generation, and a periodic sweep (plus
  shutdown cleanup) reaps any leftovers — including sessions orphaned by a
  crash — with no configuration required.
- Renders the result through the `session_prompt` host slot, ghosted inside
  the prompt box at the caret, and accepts it into the input via the prompt
  ref.

## Caveats

- **Owns the `session_prompt` slot.** opencode only exposes the prompt ref
  through that slot, so this plugin replaces the default prompt component. It
  forwards `on_submit`, `ref`, `right`, `visible`, and `disabled`, and cannot be
  combined with another plugin that also renders `session_prompt`.
- **Ghost placement.** All ghosts (next-message suggestion, typing
  completions) render inside the prompt box right after the caret; opencode
  exposes no inline-completion API, so the plugin overlays the prompt's
  editor renderable and never touches the prompt's hint row.
- **Cost.** One small-model call per turn while enabled. Point `model` at a
  cheap or free model.
- **`acceptKeys`.** `tab` is also opencode's agent-cycle key; this plugin only
  captures it while a suggestion is visible and the input is empty.
- Suggestions fail silently (no ghost text) if the model is unavailable, the
  provider is out of balance, or the reply is `NONE`.

## Development

```sh
bun install
bun run typecheck
bun test
```

No build step: like other opencode TUI plugins, the package ships TSX source and
opencode's runtime transpiles it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the check suite and commit
conventions, [AGENTS.md](AGENTS.md) for the design rules, and
[CHANGELOG.md](CHANGELOG.md) for what changed.

## License

MIT
