# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional Left-arrow navigation back to the home screen from an empty prompt.
- Recovery of abandoned hidden suggestion sessions on TUI startup when a marker directory is configured.

### Fixed

- Prevent suggestions from repeating the user's previous message.
- Trigger suggestions from the current session-status idle event.
- Remove hidden suggestion sessions and their markers when generation fails:
  deletion now passes the session directory, and a periodic sweep retries
  abandoned sessions (including corrupt or zero-byte markers) instead of
  leaving them behind for the life of the TUI process.

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

[Unreleased]: https://github.com/ozandogrultan/opencode-ghost/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ozandogrultan/opencode-ghost/releases/tag/v0.1.0
