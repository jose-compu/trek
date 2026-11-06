# Performance (0.17)

Agent-side latency. Model and network time that cannot be halved is a written exception. The release gate is wall clock from Enter to a finished answer.

## Commands

| Command | What it measures |
|---------|------------------|
| `npm run profile:tui` | Interactive CLI startup until the TUI is first usable. Requires a TTY. |
| `npm run profile:rpc` | CLI `--mode rpc` until `get_state` returns. |
| `npm run profile:e2e` | Faux-provider wall clock for a first prompt and one O→I→A→R turn. No live APIs. |

Add `--json` to the profile scripts for a `trek-profile` JSON object after the text report and `METRIC` lines:

```bash
npm run profile:rpc -- --isolated-agent-dir --json --skip-build
```

`profile:tui` must run from an interactive terminal.

## Baselines (#113)

Record numbers before cutting latency (#109–#111). Refreshing a baseline is an explicit commit. The automated 2× budget gate is [#112](https://github.com/jose-compu/trek/issues/112).

Run the e2e fixture:

```bash
cd packages/coding-agent && npx vitest --run test/performance-baselines.test.ts --reporter=verbose
```

## Modules

| Module | Issue | Profile |
|--------|-------|---------|
| CLI / TUI / RPC startup | #109 | `profile:tui`, `profile:rpc` |
| O→I→A→R cycle | #110 | `profile:e2e` `reflective_loop_ms` |
| Session JSONL / trace writes | #111 | measured with the same faux turn |
| End-to-end first prompt | #113 | `profile:e2e` `first_prompt_ms` |
