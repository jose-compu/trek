# Trek Changelog

Release notes for `@trek/coding-agent`. Upstream Pi history lives in the parent repo `UPSTREAM.md` / Pi monorepo.

## [Unreleased]

## [0.13.0] - 2026-10-28

### Added

- Operator modes for 0.13. `supervised` waits on a gated tool. `delegated` runs a gated tool named in `--operator-grant`. `checkpoint` keeps the act phase closed until it is opened. `diagnostic` remains trace-only. The laws are unchanged.
- A selected Archon workflow is called node by node. A prompt node is one model step. `$USER_MESSAGE` and `$id.output` are substituted once. A `loop` node is an object with `prompt`, `until`, and `max_iterations`. `command`, `script`, and `loop` still do not run.
- An ambiguous or destructive prompt asks one question and does not call the model. `--tone plain` changes wording and leaves law text unchanged. Repeating the same tool call three times is flagged as a loop.
- Telegram safe mode. An owner runs the agent. A guest may talk and gets no tools, no confirmations, and no model call when the text asks for a secret, a tool, or a rule change. A stranger is still ignored.

## [0.12.0] - 2026-10-28

### Added

- Domain workflows. Twenty Archon workflows ship with the package. Meta, AI, Security, and Engineering stay on. `trek domains` and `trek workflows` list, enable, disable, add, show, and run them.
- A detected workflow draws a green `workflow` call. Filled parameters are colored inside the call. The YAML sent to the model stays plain.

## [0.11.0] - 2026-10-28

### Added

- Memory release. Local memory on LogosDB. `remember`, `recall`, and `forget` use three stores: session, project (`.trek/memory/`), and global (off unless enabled). A project lesson is recalled by a later session in that repo. File chunks and thinking traces are embedded with a situating header. `/memory` shows the layers and the live chunk count in each store. `memory.enabled: false` or `--memory off` skips indexing, the watcher, and embeddings.
- `/memory add <path>` indexes a file or folder, including one that gitignore skipped. `/memory remove <path>` drops those chunks and leaves them out of later reindexes. `/memory` lists the included and excluded paths.

### Changed

- A recall card colors the layer, kind, tag, and file span. The passage stays in the tool-output color. The text sent to the model stays plain.

## [0.10.3] - 2026-10-28

### Added

- `/memory add <path>` indexes a file or folder, including one that gitignore skipped. `/memory remove <path>` drops those chunks and leaves them out of later reindexes. `/memory` lists the included and excluded paths.

## [0.10.2] - 2026-10-28

### Changed

- A recall card colors the layer, kind, tag, and file span. The passage stays in the tool-output color. The text sent to the model stays plain.

## [0.10.1] - 2026-10-28

### Added

- Local memory on LogosDB. `remember`, `recall`, and `forget` use three stores: session, project (`.trek/memory/`), and global (off unless enabled). A project lesson is recalled by a later session in that repo. File chunks and thinking traces are embedded with a situating header. `/memory` shows the layers and the live chunk count in each store. `memory.enabled: false` or `--memory off` skips indexing, the watcher, and embeddings.

## [0.10.0] - 2026-10-28

### Added

- `--effort off|normal|loose` and the `effort` setting. `loose` multiplies every effort stop by 10. `off` does not stop the turn for effort. Safety checks stay on.
- Independent reads, and edits of different files, run together. Edits of the same file stay in order. `trek processes` and `/processes` print parallel, sequence, guarded choice, and inversion, with the session seed, including a prompt that uses one tool at a time. A revert applies the inverse, then `.trek` history, then git.

## [0.9.1] - 2026-10-28

### Fixed

- An edit that already matches the file is not shown in the terminal.

## [0.9.0] - 2026-10-28

### Fixed

- A large `edit` call whose `edits` array arrives as a JSON string is parsed, including raw newlines. A cut-off payload keeps the complete replacements. The validation error no longer echoes the whole argument payload.
- An `edit` whose middle lines drifted still replaces the block when the first and last lines uniquely bound a region of similar size. Copied line-number prefixes are ignored. A miss quotes the current lines.
- An `edit` whose replacement already matches the file reports that no change is needed. It does not fail, and it does not blame special characters.
- Different edits of the same file are no longer treated as one edit. A turn may edit different files together. A second edit of the same file in that turn waits.
- An edit that puts back text already replaced in the same prompt is refused, including when that text sits inside a larger block. The latest command errors stay in that result.
- An edit that already matches the file is reported once. The same notice does not repeat.
- A failed command shows the located `error:` lines before the exit code. The same errors stop the turn, and so does the fourth failure of that command.

### Added

- `spawn_subtask` hands the child a summary only and aborts past depth 5. IntentionFilter repairs a summary that names no next action, then the turn continues.
- The live tool loop stops when the same action is used 4 times, the same error repeats 8 times, or the prompt uses its 48 tool calls. A new error, such as a failed build log, is progress. The result includes the EffortRegulator reason.
- Component routing from `routing.components` or the dynamic policy. Audit steps record the route reason. Workhorse is unchanged. A later Decision model such as Jev can use that slot.
- Short thinking traces (#108). Tool turns use reasoning effort `minimal` and a 128-token thinking budget. Local GGUFs get the cap in the prompt.

### Security

- `--approve` / `--no-approve` gate project `.trek` resources and ancestor `AGENTS.md` / `CLAUDE.md` files (GHSA-mqxh-6gq7-558m). Non-interactive runs do not load those files until a saved decision or `--approve`. Recorded in `UPSTREAM.md`.

## [0.8.1] - 2026-10-01

### Fixed

- Production dependencies: `brace-expansion` 5.0.12, `protobufjs` 7.6.6, `shell-quote` 1.11.0, and `undici` 8.11.2.

## [0.8.0] - 2026-09-30

### Added

- `trek models` for the 0.8.0 hierarchy. Default is `api` (no llama-server). `local` and `hybrid` opt in. Audit steps record the role and source.

### Changed

- A local role completes on `llama-server`. The saved API model is left unchanged. A missing GGUF does not fall back to the API.
- Pure local mode requires a tool for a build, run, or open request until a file tool and `bash` have both run.
- Honesty status is `honesty confidence=<level> assumptions=<n> unverified=<n>`. Trailing status chatter is omitted.
- `llama-server` stderr goes to `~/.trek/logs/llama-server.log`. The session stops the server on exit. A local completion stops after 120 seconds or 4,096 tokens.

## [0.7.5] - 2026-09-08

### Fixed

- Do not treat a missed oldText as already applied just because newText exists elsewhere. If DBODY is still in the file, retry edit.
- Re-run a cached edit when oldText is still on disk. Set replaceAll to change every occurrence instead of rewriting the file.

## [0.7.4] - 2026-09-08

### Fixed

- Failed edits are not cached, so a retry can run. Duplicate success says the change is already applied and must not be rewritten.
- If oldText misses but newText is already uniquely in the file, edit reports that and does not rewrite.

## [0.7.3] - 2026-09-08

### Fixed

- Edit matches when only indentation or tabs/spaces differ, and failed edits tell the model to retry instead of rewriting the file.
- Strip leftover `[idempotent]` prefixes from old tool results before they reach the model ([#96](https://github.com/jose-compu/trek/issues/96)).
- Do not cache bash in the same prompt. Re-running the same command after an edit must execute again.

## [0.7.2] - 2026-09-07

### Fixed

- Drop the `[idempotent]` prefix from duplicate write/edit/bash tool results so models see plain language, not a wrapper tag ([#96](https://github.com/jose-compu/trek/issues/96)).

## [0.7.1] - 2026-09-07

### Fixed

- Stop Grok 4.6 reasoning loops: honor thinking level via `reasoning_effort`, abort repeated thinking, and do not auto-retry that error ([#95](https://github.com/jose-compu/trek/issues/95)).

## [0.7.0] - 2026-09-01

### Added

- **Reproducibility policy** (`default` / `strict_audit`), session seed (default `42`, D5), and `trek:reproducibility` session JSONL record ([#70](https://github.com/jose-compu/trek/issues/70), [#75](https://github.com/jose-compu/trek/issues/75)).
- **Seed propagation** to seed-capable providers; Anthropic omits seed ([#71](https://github.com/jose-compu/trek/issues/71)).
- **Startup determinism warning** and `trek config reproducibility` ([#72](https://github.com/jose-compu/trek/issues/72), [#74](https://github.com/jose-compu/trek/issues/74)).
- **`trek:audit_step`** per LLM completion, including `system_fingerprint` when present ([#73](https://github.com/jose-compu/trek/issues/73)).
- **Audit acceptance gate** for same-seed tool intent, fingerprint, and `strict_audit` ([#76](https://github.com/jose-compu/trek/issues/76)).

### Changed

- Package version 0.7.0; CLI help documents `trek config reproducibility` and `TREK_SEED` ([#77](https://github.com/jose-compu/trek/issues/77)).

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
