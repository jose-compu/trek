# Trek Changelog

Release notes for `@trek/coding-agent`. Upstream Pi history lives in the parent repo `UPSTREAM.md` / Pi monorepo.

## [Unreleased]

### Added

- **Reproducibility policy** (`default` / `strict_audit`), session seed (default `42`, D5), and `trek:reproducibility` session JSONL record ([#70](https://github.com/jose-compu/trek/issues/70), [#75](https://github.com/jose-compu/trek/issues/75)).
- **Seed propagation** to seed-capable providers; Anthropic omits seed ([#71](https://github.com/jose-compu/trek/issues/71)).

## [0.6.0] - 2026-08-27

### Added

- **Trace schema v1** (`trek:reflective_cycle`): timestamps, cycle id, tool names, laws pre/post ([#45](https://github.com/jose-compu/trek/issues/45)).
- **`trek trace list|show|diff`**: list cycle ids, show a cycle, diff intention vs outcome ([#46](https://github.com/jose-compu/trek/issues/46), [#48](https://github.com/jose-compu/trek/issues/48)).
- **`trek trace fork`** and cycle-boundary checkpoints (`trek:cycle_checkpoint`) ([#46](https://github.com/jose-compu/trek/issues/46), [#47](https://github.com/jose-compu/trek/issues/47)).
- **Diagnostic mode** (`--diagnostic` / `TREK_DIAGNOSTIC=1` / settings `diagnostic`) blocks mutating tools ([#49](https://github.com/jose-compu/trek/issues/49)).
- **`trek trace replay`** counterfactual stub: fork + patched observe ([#50](https://github.com/jose-compu/trek/issues/50)).
- **Trace test gate** (faux LLM): fork from cycle 5, laws pre/post, intention vs outcome, counterfactual observe ([#51](https://github.com/jose-compu/trek/issues/51)).
- **`trek telegram`**: long-poll Bot API, token/allowlists, isolated DM sessions ([#52](https://github.com/jose-compu/trek/issues/52), [#53](https://github.com/jose-compu/trek/issues/53)).
- **Telegram Groups** (mention/command) and `/confirm` gated destructive ops ([#54](https://github.com/jose-compu/trek/issues/54), [#55](https://github.com/jose-compu/trek/issues/55)).
- **Telegram media**: inbound photos/documents staged under `.trek/telegram/inbox/`; long replies split or sent as a file; group traces omitted; stickers/voice ack unsupported ([#56](https://github.com/jose-compu/trek/issues/56)).

### Changed

- README/CLI help document `trek trace` and `trek telegram` allowlists and group safety; package version 0.6.0 ([#58](https://github.com/jose-compu/trek/issues/58)).

## [0.5.1] - 2026-08-23

### Changed

- GitHub release binaries/archives renamed from `pi-*` to `trek-*`; compiled binary is `trek` / `trek.exe`.

### Added

- Pi plugin compatibility regression tests for Pi import shims and `trek` / `pi` manifest fallbacks ([#41](https://github.com/jose-compu/trek/issues/41)).

## [0.5.0] - 2026-08-22

### Added

- **`.trek` version store:** numbered diffs/snapshots and `manifest.json`.
- **`trek history` / `trek revert --prompt N|--step ID`.**
- **JSONL undo persistence** (`trek:edit_batch_checkpoint`) reloaded on session resume.
- **Bash `rm`/`mv` snapshots** for invertible path ops.
- **`--git-commit`:** optional labeled `trek: prompt #N` commits; refs stored in the manifest.
- **Idempotency** for duplicate write/edit/bash in the same prompt.

### Fixed

- Dry-run no longer populates the undo buffer.

## [0.4.0] - 2026-07-02

### Added

- **SafetyChecker + Laws:** pre-flight and post-flight enforcement; read-before-write; HALT honored at tool boundaries.
- **Reversibility tiers** and **multi-level undo** (Keep All, undo selector UI, `shift+ctrl+z` / `shift+ctrl+k`).
- **Dry-run** (`shift+ctrl+y`, `--dry-run`) and **sandbox** (`/sandbox`, `--sandbox`) for write/edit/bash.
- **Honesty protocol:** structured confidence and assumption ledger in final assistant output.
- **Reflective loop:** laws verdict and O→I→A→R fields on `trek:reflective_cycle` traces.
- **Output validation:** schema-mismatch notes appended to tool results.
- **CLI/TUI:** `--verbose` print mode; shortcut bar; ASCII banner.
- **Tests:** guardrails acceptance checklist (14 cases).

### Changed

- Guardrails run before extension `tool_call` hooks; extensions remain compatible with Pi packages (`trek install npm:<package>`).

## [0.3.0] - 2026-06-14

### Added

- **Reflective loop (O→I→A→R):** wraps each user prompt; Act phase uses existing agent/tool loop.
- **Component stubs:** WorldModel, IntentionFilter, OutputGuard, ToolExecutor, PolicyConstraints, EffortRegulator, Observer, FocusManager.
- **Meta-tools:** `observe()`, `reflect(scope)`; JSONL trace type `trek:reflective_cycle`.
- Disable with `TREK_REFLECTIVE_LOOP=0`.

## [0.2.1] - 2026-06-14

### Added

- **Prompt labels in TUI:** `#1`, `#2`, … on user messages and in the input editor (next prompt id).

### Fixed

- **Post-compaction resume:** auto-retry after context overflow no longer errors on assistant-last context.
- **Startup changelog:** filter entries above the running package version (no Pi `0.10.x` on Trek `0.2.0`).

### Changed

- **`TREK_*` env vars** with legacy `PI_*` fallback; user-facing Trek branding (docs partially Pi-branded).

## [0.2.0] - 2026-06-04

### Added

- **Prologue / constitution:** load `~/.trek/prologue.md` or project `.trek/prologue.md`; bundled project prologue in this repo.
- **Prompt numbering:** monotonic `#1`, `#2`, … markers in session JSONL (`prompt_meta` entries).
- **Batch CLI:** `trek --batch prompts.txt`, stdin pipe, and `--output jsonl`.
- **Debug mode:** `trek --debug` or `TREK_DEBUG=1` for gated internal logging.

## [0.1.0] - 2026-06-04

### Added

- **Genesis:** hard fork from Pi Coding Agent — Trek CLI, `@trek/*` packages, `~/.trek` config layout.
- Pi plugin compatibility shims and baseline build/test pipeline.
