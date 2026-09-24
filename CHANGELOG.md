# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/ozandogrultan/opencode-ghost/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ozandogrultan/opencode-ghost/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ozandogrultan/opencode-ghost/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ozandogrultan/opencode-ghost/releases/tag/v0.1.0
