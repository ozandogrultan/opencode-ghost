# AGENTS.md — ghost

## What this is

An [opencode](https://opencode.ai) **TUI plugin** that suggests your next prompt
after each turn, rendering it as dimmed ghost text accepted with `Tab`/`→`, plus
purely local slash-argument and history ghosts while you type. `README.md` is the
user-facing contract — read it before changing behaviour.

## Layout

- `src/tui.tsx` — the plugin: hooks, prompt rendering, ghost placement, the
  hidden suggestion session, and the `/suggest` toggle.
- `src/options.ts`, `src/text.ts`, `src/completion.ts`, `src/builtins.ts` —
  pure helpers (option parsing/validation, transcript trimming, slash and
  history completion, builtin command data).
- `test/` — bun tests (`bun test`).
- `tests/changelog.sh`, `scripts/changelog.sh` — release bookkeeping.
- `install.sh` — copies the plugin into opencode's config and registers it in
  `tui.json`.

## Commands

```bash
bun install
bun run test        # bun test + changelog tooling
bun run typecheck   # tsc --noEmit
bun run lint:sh     # bash -n on the scripts
```

## Hard-won rules — do not regress

- **Owns the `session_prompt` slot.** opencode only exposes the prompt ref
  through that slot, so the plugin replaces the default prompt component. It
  forwards `on_submit`, `ref`, `right`, `visible`, and `disabled`; it cannot be
  combined with another plugin that renders `session_prompt`.
- **Ghosts render in the prompt box** right after the caret; the prompt's hint
  row is never touched, in any state. Placement uses absolute screen
  coordinates, and ghosts clear reliably when the input no longer matches.
- **`acceptKeys` stays scoped.** `tab` is also opencode's agent-cycle key; the
  plugin captures it only while a suggestion is visible and the input is empty.
- **The typing ghosts stay local.** Slash-argument and history completion make
  no model calls; only the next-message suggestion does, in a hidden session
  with tools disabled that is deleted immediately afterwards.
- **Hidden sessions are always reaped,** including after a crash: they carry a
  metadata tag that survives title generation, and a configuration-free sweep
  plus shutdown cleanup removes leftovers.

## Verifying

```bash
bun run test && bun run typecheck && bun run lint:sh
```

## Conventions

Commits follow [Conventional Commits](CONTRIBUTING.md#commit-messages); the type
decides the release bump. See `CONTRIBUTING.md` and `RELEASING.md`.
