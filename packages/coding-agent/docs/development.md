# Development

See [AGENTS.md](../../../AGENTS.md) in this repository.

## Setup

```bash
git clone https://github.com/jose-compu/trek
cd trek
npm install
npm run build
```

The 1.0 candidate line is `release-1-0-rc1`. The stable line is `release-0-20` (v0.20.8).

Run from source:

```bash
/path/to/trek/trek-test.sh
```

The script can be run from any directory. Trek keeps the caller's current working directory.

## Forking / Rebranding

This package sets `trekConfig` in `package.json`. `piConfig` is only the fallback for a Pi plugin package that does not set `trekConfig`.

```json
{
  "trekConfig": {
    "name": "trek",
    "configDir": ".trek"
  }
}
```

`name` becomes the CLI banner and the debug-log file prefix. `configDir` is the project directory name.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug logs

`trek --debug` or `TREK_DEBUG=1` appends to `~/.trek/agent/trek-debug.log` through `debugLog`. Before a line is written, flag values for `--api-key`, `--api_key`, `--token`, `--access-token`, `--auth-token`, `--password`, and `--secret` are replaced with `[redacted]`, including the `--flag=value` form. The same pass replaces provider-shaped secrets (`sk-`, `sk-ant-`, `sk-or-v1-`, `xai-`, `ghp_`, `hf_`, `gsk_`, `csk-`, Bearer tokens) and object keys such as `api_key`, `authorization`, `password`, `secret`, and `token`.

`/debug` overwrites `~/.trek/agent/trek-render-debug.log`. Each rendered line is logged as `JSON.stringify(redactSecretText(line))` with visible width taken from the original line. Session messages are logged as `JSON.stringify(redactDebugData(message))`. Header lines (`Debug output at`, `Terminal:`, `Total lines:`) are not redacted.

## Testing

```bash
./test.sh                         # Run non-LLM tests (no API keys needed)
npm test                          # Run all tests
npm test -- test/specific.test.ts # Run specific test
npm run profile:rpc -- --isolated-agent-dir --json --skip-build
npm run profile:e2e
```

`profile:tui` needs a TTY. Budgets live in `packages/coding-agent/test/performance-budgets.json`. See [Performance](performance.md).

## Project Structure

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types  
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```
