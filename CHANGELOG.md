# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Slash-command argument hints are dimmed at the same opacity as every other
  ghost; they keep the theme accent hue but no longer appear brighter than the
  next-message and history ghosts.

## [0.2.4] - 2026-09-25

### Fixed

- Long next-message suggestions now wrap onto extra rows and grow the prompt
  box instead of being clipped at its right edge, so the whole suggestion stays
  readable.
- Slash commands and skills only suggest their accepted argument flags (from
  `argHints`); command and skill descriptions are no longer echoed as if they
  were arguments. Commands without hints show no ghost.

### Changed

- Ghost styling: slash-command ghosts use the theme accent color, and every
  other ghost is dimmed and clipped to the prompt box so it cannot be mistaken
  for typed text.
## [0.2.3] - 2026-09-25

### Removed

- The temporary `GHOST_DEBUG` diagnostic toasts introduced while localizing
  the in-box ghost overlay.
## [0.2.2] - 2026-09-25

### Changed

- All ghosts (next-message suggestion and typing completions) render inside
  the prompt box at the caret; the prompt's hint row (status line) is left
  alone in every state.
- Typing ghosts are positioned from absolute screen coordinates (the prompt
  editor's `screenX/screenY` plus the caret's visual column/row) instead of a
  relative slot offset, and clear reliably when the input no longer matches.
## [0.2.1] - 2026-09-24

### Changed

- Slash-command completion now stays out of the way of opencode's native slash
  menu (the plugin only ghosts argument options after a complete `/name `).
- Typing ghosts (argument options, prompt history) render inside the prompt
  input box right after the caret instead of the hint row, falling back to the
  hint row when the prompt's editor renderable cannot be located.
## [0.2.0] - 2026-09-24

### Added

- Slash-command autocomplete while typing: the remaining command name is
  ghosted from configured commands, skills, and builtin TUI commands, with
  known argument options shown as `[a | b]` hints and completed with `Tab`
  (staged: command name, then arguments). Purely local — no model calls.
- Prompt-history ghost while typing: if the line being typed is a prefix of a
  message already sent in the same session, the rest is ghosted and `Tab`
  pulls the full line back.
- New option `argHints` (per-command argument option lists for the completion
  hints).

## [0.1.1] - 2026-09-24

### Added

- Optional Left-arrow navigation back to the home screen from an empty prompt.
- Recovery of abandoned hidden suggestion sessions via a periodic sweep that
  needs no configuration (an optional marker directory adds extra
  crash-recovery tracking).

### Fixed

- Prevent suggestions from repeating the user's previous message.
- Trigger suggestions from the current session-status idle event.
- Remove hidden suggestion sessions and their markers when generation fails:
  deletion now passes the session directory, and a periodic sweep retries
  abandoned sessions (including corrupt or zero-byte markers) instead of
  leaving them behind for the life of the TUI process.
- Delete hidden suggestion sessions reliably: every hidden-session call is
  scoped to the visible session's project directory, hidden sessions carry a
  metadata tag that survives the server's automatic title generation, a
  configuration-free sweep reaps leftovers by listing sessions, and shutdown
  deletes in-flight generations. Marker-tracked sessions are removed even
  after being retitled.
## [0.1.0] - 2026-09-21

### Added

- Next-prompt suggestions for the opencode TUI: after each turn a model reads
  the recent conversation and writes one short message in the user's voice.
- The suggestion renders under the prompt and is accepted with `Tab` or `→`,
  dropping it into the input to edit or send.
- `/suggest` toggles suggestions on and off; the state is persisted in the
  plugin KV.
- Options for `model`, `acceptKeys`, `maxChars`, `idleDelayMs`,
  `recentMessages` and `system`.

[Unreleased]: https://github.com/ozandogrultan/opencode-ghost/compare/v0.2.4...HEAD
[0.2.4]: https://github.com/ozandogrultan/opencode-ghost/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/ozandogrultan/opencode-ghost/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/ozandogrultan/opencode-ghost/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/ozandogrultan/opencode-ghost/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ozandogrultan/opencode-ghost/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ozandogrultan/opencode-ghost/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ozandogrultan/opencode-ghost/releases/tag/v0.1.0
