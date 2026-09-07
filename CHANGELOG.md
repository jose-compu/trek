# Trek Changelog

Monorepo release notes for **Trek Agent** (`trek-monorepo` @ `0.7.1`).

User-facing CLI details also live in [`packages/coding-agent/CHANGELOG.md`](packages/coding-agent/CHANGELOG.md) (shown at startup via `/changelog`). Package-specific histories: `packages/{ai,agent,tui}/CHANGELOG.md` (Pi upstream; Trek renames only where noted).

## [Unreleased]

### Fixed

- Drop the `[idempotent]` prefix from duplicate write/edit/bash tool results so models see plain language, not a wrapper tag ([#96](https://github.com/jose-compu/trek/issues/96)).

## [0.7.1] - 2026-09-07

### Fixed

- Stop Grok 4.6 reasoning loops: honor thinking level via `reasoning_effort`, abort repeated thinking, and do not auto-retry that error ([#95](https://github.com/jose-compu/trek/issues/95)).

## [0.7.0] - 2026-09-01

**Audit** — honest best-effort determinism (ROADMAP 0.7.0).

### Added

- **Reproducibility policy** (`default` / `strict_audit`), session seed (default `42`, D5), and `trek:reproducibility` session JSONL record ([#70](https://github.com/jose-compu/trek/issues/70), [#75](https://github.com/jose-compu/trek/issues/75)).
- **Seed propagation** to OpenAI, Gemini, Vertex, Azure, and llama.cpp-compatible completions; Anthropic omits seed. OpenAI completions copy `system_fingerprint` when present ([#71](https://github.com/jose-compu/trek/issues/71)).
- **Startup determinism warning** when the active provider cannot honor seed ([#72](https://github.com/jose-compu/trek/issues/72)).
- **`trek config reproducibility`**: show/set mode and seed ([#74](https://github.com/jose-compu/trek/issues/74)).
- **Per-step audit record** `trek:audit_step` on session JSONL (model, seed, hashes, `system_fingerprint`) ([#73](https://github.com/jose-compu/trek/issues/73)).
- **0.7.0 Audit acceptance gate** (same seed → same tool intent, fingerprint, warnings, schema) ([#76](https://github.com/jose-compu/trek/issues/76)).

### Changed

- README/CLI help document reproducibility modes, seed honesty, and `TREK_SEED`; lockstep package versions are 0.7.0 ([#77](https://github.com/jose-compu/trek/issues/77)).

## [0.6.0] - 2026-08-27

**Trace + Telegram** — O→I→A→R traces and a remote Telegram channel (ROADMAP 0.6.0).

### Added

- **Trace schema v1** on `trek:reflective_cycle`: `schemaVersion`, `cycleId`, timestamps (cycle + per phase), `toolNames`, `lawsVerdict.pre` / `lawsVerdict.post` ([#45](https://github.com/jose-compu/trek/issues/45)).
- **`trek trace list|show|diff`**: inspect session cycle traces and intention vs outcome ([#46](https://github.com/jose-compu/trek/issues/46), [#48](https://github.com/jose-compu/trek/issues/48)).
- **`trek trace fork`** and cycle-boundary checkpoints (`trek:cycle_checkpoint`) ([#46](https://github.com/jose-compu/trek/issues/46), [#47](https://github.com/jose-compu/trek/issues/47)).
- **Diagnostic mode** (`--diagnostic` / `TREK_DIAGNOSTIC=1` / settings `diagnostic`) blocks mutating tools ([#49](https://github.com/jose-compu/trek/issues/49)).
- **`trek trace replay`** counterfactual stub: fork a cycle and inject a patched observe payload ([#50](https://github.com/jose-compu/trek/issues/50)).
- **Trace test gate** (faux LLM): fork from cycle 5, laws pre/post, intention vs outcome, counterfactual observe ([#51](https://github.com/jose-compu/trek/issues/51)).
- **`trek telegram`**: long-poll Bot API, token/allowlists, isolated DM sessions and `/start|/new|/status|/stop|/help` ([#52](https://github.com/jose-compu/trek/issues/52), [#53](https://github.com/jose-compu/trek/issues/53)).
- **Telegram Groups** (mention/command, per-chat session) and remote `/confirm` + HALT isolation ([#54](https://github.com/jose-compu/trek/issues/54), [#55](https://github.com/jose-compu/trek/issues/55)).
- **Telegram media**: inbound photos/documents staged under `.trek/telegram/inbox/`; long replies split or sent as a file; group traces omitted; stickers/voice ack unsupported ([#56](https://github.com/jose-compu/trek/issues/56)).

### Changed

- README/ROADMAP current version is 0.6.0; CLI help documents `trek trace` and `trek telegram` allowlists and group safety ([#58](https://github.com/jose-compu/trek/issues/58)).
- Milestone product work is complete on `main` ([#43](https://github.com/jose-compu/trek/issues/43), [#44](https://github.com/jose-compu/trek/issues/44)); remaining release chore is the `v0.6.0` git tag.

## [0.5.1] - 2026-08-23

### Changed

- GitHub release binaries renamed from `pi-*` to `trek-*`.

### Added

- Pi plugin compatibility regression tests ([#41](https://github.com/jose-compu/trek/issues/41)).

### Fixed

- `@trek/ai`: refreshed models.dev catalog metadata.

## [0.5.0] - 2026-08-22

**Undo** — durable `.trek` file history (ROADMAP 0.5.0).

### Added

- **`.trek/manifest.json` + version artifacts:** diffs for edits; full snapshots on create/delete/rename.
- **Session JSONL checkpoints:** `trek:edit_batch_checkpoint` so in-session undo survives restart.
- **CLI:** `trek history`, `trek revert --prompt N`, `trek revert --step ID`.
- **Parsed bash undo:** simple `rm` / `mv` (no pipes) snapshot before mutation.
- **Optional labeled git commits:** `--git-commit` / `TREK_GIT_COMMIT=1` (no stash, no history rewrite).
- **Idempotency keys** on write/edit/bash for the current prompt.
- **Dry-run** no longer records undo batches.

### Tests

- ROADMAP gate (3-prompt revert, delete snapshot, gated block) plus scripted mock operator shortcuts.

## [0.4.0] - 2026-07-02

**Guardrails** — safety harness minimum (SPECS_SAFETY_HARNESS MVP).

### Added

- **SafetyChecker + Laws hierarchy:** pre-flight and post-flight checks on mutating tools (Law 0 harmful intent, Law 1 destructive shell / read-before-write).
- **HALT / Off switch** at tool boundaries; new user prompt clears HALT (explicit resume).
- **Reversibility tiers** on built-in tools: `free | cheap | gated | forbidden`.
- **Undo engine:** multi-level undo (`undoLastBatches`, `undoToPrompt`), Keep All, undo selector UI in TUI.
- **Dry-run** for write/edit/bash (TUI toggle, `--dry-run` CLI flag).
- **Sandbox** for bash via macOS `sandbox-exec` (`/sandbox`, `--sandbox` CLI flag).
- **Honesty protocol:** confidence + `assumption_ledger[]` in final output; verified vs `from_training_unverified` claims.
- **Reflective loop integration:** O→I→A→R trace fields and `lawsVerdict` on cycle traces.
- **Typed tool output validation** with `[schema-mismatch]` reflection notes.
- **TUI polish:** shortcut bar (`shift+ctrl+/`), ASCII banner above input; print mode `--verbose`.
- **Acceptance test gate:** `guardrails-checklist.test.ts` (14 tests) + live CLI smoke script.
- **Pi Coding Agent plugins:** community packages from [pi.dev/packages](https://pi.dev/packages) install via `trek install npm:<package>`; Pi import aliases and `"pi"` manifests supported (see README).

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
