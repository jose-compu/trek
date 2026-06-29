# Trek Changelog

Monorepo release notes for **Trek Agent** (`trek-monorepo` @ `0.3.0`).

User-facing CLI details also live in [`packages/coding-agent/CHANGELOG.md`](packages/coding-agent/CHANGELOG.md) (shown at startup via `/changelog`). Package-specific histories: `packages/{ai,agent,tui}/CHANGELOG.md` (Pi upstream; Trek renames only where noted).

## [Unreleased]

## [0.3.0] - 2026-06-14

**Loop** — reflective agent skeleton (O→I→A→R).

### Added

- **Reflective loop:** Observe → Intend → Act → Reflect per prompt; Act delegates to existing agent loop.
- **Eight component stubs** + PolicyConstraints / EffortRegulator gates.
- **Meta-tools** `observe()` and `reflect(scope)`; session JSONL `trek:reflective_cycle` traces.
- Opt out: `TREK_REFLECTIVE_LOOP=0`.

## [0.2.1] - 2026-06-14

### Added

- **Prompt labels in TUI:** `#1`, `#2`, … on user messages and in the input editor (next prompt id).

### Fixed

- **Post-compaction resume:** auto-retry no longer fails with “Cannot continue from message role: assistant”.
- **Startup changelog:** Trek entries only (Pi `0.10.x` no longer treated as newer than Trek `0.2.0`).

### Changed

- **`TREK_*` env vars:** primary prefix (`TREK_DEBUG`, `TREK_OFFLINE`, `TREK_ALLOW_LOCKFILE_CHANGE`, …); legacy `PI_*` still accepted.
- **Branding:** user-facing strings use Trek instead of Pi where applicable.

## [0.2.0] - 2026-06-04

**Prologue** — constitution, batch CLI, prompt numbering, debug mode.

### Added

- **Prologue / constitution:** load `~/.trek/prologue.md` or project `.trek/prologue.md`; bundled `.trek/prologue.md` in this repo.
- **Prompt numbering:** monotonic `#1`, `#2`, … in session JSONL (`prompt_meta` entries).
- **Batch CLI:** `trek --batch prompts.txt`, stdin pipe, `--output jsonl`.
- **Debug mode:** `trek --debug` or `TREK_DEBUG=1`.

## [0.1.0] - 2026-06-04

**Genesis** — hard fork from Pi Coding Agent.

### Added

- Trek CLI, `@trek/*` workspace packages, `~/.trek` config layout.
- Pi plugin compatibility shims and baseline build/test pipeline.
- [`UPSTREAM.md`](UPSTREAM.md) pinning Pi baseline.
