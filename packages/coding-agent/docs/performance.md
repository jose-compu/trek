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

## Baselines (#113) and budgets (#112)

Record numbers before cutting latency (#109–#111). The CI gate is `test/performance-budgets.json` (`budgets_ms`). A slower time fails `npm test` until that file is changed on purpose.

```bash
cd packages/coding-agent && npx vitest --run test/performance-budgets.test.ts test/performance-baselines.test.ts test/session-manager/jsonl-write-path.test.ts --reporter=verbose
```

To accept a slower machine or a real regression: raise the metric in `performance-budgets.json`, note why in the PR, keep `recorded_ms` as the last local snapshot.

## Modules

| Module | Issue | Profile |
|--------|-------|---------|
| CLI / TUI / RPC startup | #109 | `profile:tui`, `profile:rpc` |
| O→I→A→R cycle | #110 | `profile:e2e` `reflective_loop_ms` |
| Session JSONL / trace writes | #111 | `test/session-manager/jsonl-write-path.test.ts` (`METRIC jsonl_append_400_ms`) |
| End-to-end first prompt | #113 | `profile:e2e` `first_prompt_ms` |
