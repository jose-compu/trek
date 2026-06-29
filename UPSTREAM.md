# Upstream

Trek Agent is a hard fork of the [Pi Coding Agent](https://github.com/earendil-works/pi).

| Field | Value |
|---|---|
| Upstream repo | `pi-original/` in parent workspace (from earendil-works/pi) |
| Pinned commit | `dc7b547f628475676acfd00cb0f54df05d42acaf` |
| Fork version | `0.1.0` (Genesis) |
| Fork date | 2026-06-04 |

## Rename map (0.1.0)

| Pi | Trek |
|---|---|
| CLI `pi` | `trek` |
| Config dir `.pi` | `.trek` |
| User config `~/.pi/agent` | `~/.trek/agent` |
| `@earendil-works/pi-*` | `@trek/*` |
| `piConfig` | `trekConfig` (with `piConfig` / `pkg.pi` fallback for Pi plugins) |

## Pi plugin compatibility

Extensions importing `@earendil-works/pi-*` or `@mariozechner/pi-*` continue to resolve via virtual module aliases in the extension loader.
