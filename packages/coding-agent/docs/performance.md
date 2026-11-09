# Performance (0.17)

Agent-side latency. Model and network time that cannot be halved is a written exception. The release gate is wall clock from Enter to a finished answer on the faux-provider e2e script.

Package versions are **0.17.0**. This page matches the tagged release.

## Commands

| Command | What it measures | Output |
|---------|------------------|--------|
| `npm run profile:tui` | Interactive CLI startup until the TUI is first usable. Requires a TTY. | Text report; `--json` adds a `trek-profile` object (`kind`, `startup_time_ms`, `phases`). |
| `npm run profile:rpc` | CLI `--mode rpc` until `get_state` returns. | Same. |
| `npm run profile:e2e` | Faux-provider wall clock for a first prompt and one O→I→A→R turn. No live APIs. | `METRIC first_prompt_ms=…`, `METRIC reflective_loop_ms=…`, then a `trek-e2e-wall-clock` JSON line. |

```bash
npm run profile:rpc -- --isolated-agent-dir --json --skip-build
```

Example `--json` shape (`profile:tui` / `profile:rpc`):

```json
{
  "kind": "trek-profile",
  "version": 1,
  "runtime": "node",
  "mode": "rpc",
  "runs": 1,
  "startup_time_ms": { "min": 0, "median": 0, "avg": 0, "max": 0 },
  "phases": {}
}
```

`profile:tui` must run from an interactive terminal.

## Baselines (#113) and budgets (#112)

Record numbers before cutting latency (#109–#111). The CI gate is `test/performance-budgets.json` (`budgets_ms`). A slower time fails `npm test` until that file is changed on purpose. `recorded_ms` is the last local snapshot, not the gate.

Current budgets: first prompt 2000 ms, reflective loop 2000 ms, JSONL 400-append 200 ms. Local snapshots on this machine were about 65 / 34 / 8 ms.

```bash
cd packages/coding-agent && npx vitest --run test/performance-budgets.test.ts test/performance-baselines.test.ts test/session-manager/jsonl-write-path.test.ts --reporter=verbose
```

To accept a slower machine or a real regression: raise the metric in `performance-budgets.json`, note why in the PR, keep `recorded_ms` as the last local snapshot.

**2× exception:** live model tokens and network RTT are not in the faux e2e number. Startup that waits on a MiniLM download is not in the budget either; downloads stay opt-in via `TREK_MEMORY_DOWNLOAD` (see [Concurrent sessions](#concurrent-sessions)).

## Modules

| Module | Issue | Profile |
|--------|-------|---------|
| CLI / TUI / RPC startup | #109 | `profile:tui`, `profile:rpc` |
| O→I→A→R cycle | #110 | `profile:e2e` `reflective_loop_ms` |
| Session JSONL / trace writes | #111 | `test/session-manager/jsonl-write-path.test.ts` (`METRIC jsonl_append_400_ms`) |
| End-to-end first prompt | #113 | `profile:e2e` `first_prompt_ms` |

## Compact console

Default cards are 1–4 lines (`ctrl+o` expands). Compact start has no persistent TREK AGENT banner; expand restores banner, header, and loaded resources. Footer cwd is `/path:trek-agent@X.Y.Z`. See [Usage](usage.md) and [Keybindings](keybindings.md) (`app.tools.expand`).

## Concurrent sessions

Several `trek` TUI processes may run on one machine.

| Variable | Default | Effect |
|----------|---------|--------|
| `TREK_NO_LOCAL_LLM` | unset | `1` keeps chat on the API model (`PI_NO_LOCAL_LLM` still accepted) |
| `TREK_MEMORY_LOCAL` | on | `0` skips MiniLM/ONNX (bag-of-words); unset or `1` prefers MiniLM in every mode |
| `TREK_MEMORY_DOWNLOAD` | off | `1` may download MiniLM; otherwise `local_files_only` |
| `TREK_LLAMA_PORT_START` | `18080` | First port to probe for `llama-server` |

- **API mode** does not start `llama-server`. Memory still prefers MiniLM for lessons; missing weights fall back to bag-of-words. Use `TREK_MEMORY_LOCAL=0` to skip ONNX.
- MiniLM uses `local_files_only` unless `TREK_MEMORY_DOWNLOAD=1`.
- Each process probes upward from `TREK_LLAMA_PORT_START` for a free `llama-server` port.

```bash
export TREK_NO_LOCAL_LLM=1
trek --provider xai --model grok-4.20-0309-reasoning
```
