# Trek Changelog

Release notes for `@trek/coding-agent`. Upstream Pi history lives in the parent repo `UPSTREAM.md` / Pi monorepo.

## [Unreleased]

### Added

- **Trace schema v1** (`trek:reflective_cycle`): timestamps, cycle id, tool names, laws pre/post ([#45](https://github.com/jose-compu/trek/issues/45)).
- **`trek trace list|show|diff`**: list cycle ids, show a cycle, diff intention vs outcome ([#46](https://github.com/jose-compu/trek/issues/46), [#48](https://github.com/jose-compu/trek/issues/48)).
- **`trek trace fork`** and cycle-boundary checkpoints (`trek:cycle_checkpoint`) ([#46](https://github.com/jose-compu/trek/issues/46), [#47](https://github.com/jose-compu/trek/issues/47)).

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
