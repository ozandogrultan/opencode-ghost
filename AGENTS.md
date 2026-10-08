# AGENTS.md — ghost

## What this is

An [opencode](https://opencode.ai) **V2 TUI plugin** that suggests your next
prompt after each turn, rendered as a dimmed inline placeholder in the empty
composer with `Tab`/`→` to accept, plus the `/suggest`
toggle. `README.md` is the user-facing contract — read it before changing
behaviour.

## Layout

- `src/tui.tsx` — the plugin: `Plugin.define({ id, setup })`, the
  `session.execution.succeeded` hook, generation, the footer marker, and
  the accept keymap.
- `src/options.ts`, `src/text.ts`, `src/transcript.ts`, `src/stateless.ts`,
  `src/composer.ts`, `src/lifecycle.ts`, `src/placeholder.ts` —
  pure helpers (option parsing/validation, text normalization, transcript
  building, the `generate.text` call).
- `test/` — bun tests (`bun test`).
- `tests/changelog.sh`, `scripts/changelog.sh` — release bookkeeping.
- `install.sh` — copies the plugin into opencode's config and registers it in
  `cli.json` by directory, migrating an old v1 `tui.json` registration if found.

## Commands

```bash
bun install
bun run test        # bun test + changelog tooling
bun run typecheck   # tsc --noEmit
bun run lint:sh     # bash -n on the scripts
```

## Hard-won rules — do not regress

- **Local TUI registrations target directories.** V2 skips file targets;
  register the installed `plugins/opencode-ghost` directory or the repo's `src`.
  Validate both CLI and legacy TUI configs before changing installed sources.
- **Observe input before the keymap.** Prepend public renderer key/paste
  listeners and remove them on unload. Handled keys stop propagation; ordinary
  listeners cannot reliably cancel generation or dismiss previews.
- **Generation is stateless.** Suggestions come from `context.client.generate.text`,
  which creates no session. Never reintroduce a hidden-session fallback.
- **Default to the small model.** Runtime and option overrides precede the
  effective public title-agent model, then the host's same-provider small-model
  family policy. Never call generation without a resolved model or fall back to
  the main model/another provider. Recheck cancellation and route after resolution.
- **Direct insertion, no clipboard.** Identify the editor through a session-scoped `prompt.footer`
  marker and public renderer ancestry, checking the host composer's clipboard
  expansion method as an identity guard. The host textarea has no explicit ID.
  Refuse if identity, normal mode or focus cannot be established.
- **`acceptKeys` stays scoped.** The V2 agent-cycle key is `shift+tab`; the
  accept command only claims it while a suggestion is visible and the
  actual composer is empty, idle, in normal/base mode and focused.
  Otherwise `run` returns `false` so the key falls through to the host.
- **Every generation is cancellable.** A debounced `AbortController` run backs
  each suggestion; it is aborted when a newer turn finishes, the visible
  session changes, typing/pasting occurs, execution starts, suggestions are
  disabled, or the plugin unloads. Deduplicate completion IDs across the load.
- **Own only the placeholder.** Use the textarea's public placeholder/color
  setters, never its buffer, for display. Synchronize through Solid effects and
  the public pre-render callback, preserving host updates and rich placeholders.
  Restore only owned values on dismissal/replacement/unload; skip destroyed editors.
- **No inline typing ghosts.** Only an empty eligible composer displays a
  next-prompt placeholder. Acceptance inserts editable text and never submits it.

## Verifying

```bash
bun run test && bun run typecheck && bun run lint:sh
```

## Conventions

Commits follow [Conventional Commits](CONTRIBUTING.md#commit-messages); the type
decides the release bump. See `CONTRIBUTING.md` and `RELEASING.md`.
