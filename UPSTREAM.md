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

## Security grab (v0.9.0 work, not yet tagged)

Reviewed [earendil-works/pi](https://github.com/earendil-works/pi) advisories against this tree on 2026-10-27. The pin above is Pi 0.78.0. Trek did not merge Pi 0.79.0 through 1.4.0. Only the security items below were taken.

| Advisory | Severity | Upstream fix | Trek |
|---|---|---|---|
| GHSA-jfgx-wxx8-mp94 / CVE-2026-54328 | high | Pi 0.78.1. Extension temp dir is under the agent dir, mode `0700`. Git install paths refuse components outside the install root. | Already present before this grab. `getExtensionTempFolder` and `resolveManagedPath` in `packages/coding-agent/src/core/package-manager.ts`. |
| GHSA-7v5m-pr3q-6453 / CVE-2026-54326 | low | Pi 0.78.1. HTML export allow-lists URL schemes and strips C0 controls. | Already present. `sanitizeMarkdownUrl` in `packages/coding-agent/src/core/export-html/template.js`. |
| GHSA-r95r-rj6r-c39x / CVE-2026-54327 | low | Pi 0.78.1. `auth.json` is written mode `0600`, then `chmod` `0600`. | Already present. `AUTH_FILE_WRITE_OPTIONS` in `packages/coding-agent/src/core/auth-storage.ts`. |
| GHSA-mqxh-6gq7-558m / CVE-2026-54325 | medium | Pi 0.79.0, commit `89a92207f1` (`feat(coding-agent): add project trust gating`, 2026-06-05). | Ported here for the unreleased 0.9.0 line. Adapted to `.trek` and `@trek/tui`. |

Dependency advisories that Pi later bumped (`brace-expansion`, `protobufjs`, `undici`) are already pinned in Trek 0.8.1 at equal or newer versions, plus `shell-quote` 1.11.0 and Gondolin's `undici` 6.29.0. This grab does not downgrade those pins.

Not taken: MCP OAuth changes, `pi auth check`, and the ModelRuntime replacement. Those are features, not the published advisories above.

### Project trust behavior

Source: `packages/coding-agent/src/core/trust-manager.ts`. Decisions are stored in `~/.trek/agent/trust.json`.

A directory needs a decision when it, or an ancestor, has `.trek`, `AGENTS.md`, `CLAUDE.md`, or `.agents/skills`.

- `--approve` / `-a` trusts project files for that run.
- `--no-approve` / `-na` ignores them for that run.
- Interactive mode with no saved decision asks. Trust and Do not trust can be remembered.
- Print, JSON, RPC, and batch modes with no saved decision do not load project settings, project extensions, project skills, project themes, project system prompts, or ancestor instruction files.
- User-level `~/.trek/agent` resources still load.
- Explicit CLI `-e` / skill / prompt / theme paths still load.
- `SettingsManager.create` stays trusted unless `projectTrusted: false` is passed. The CLI sets that flag. SDK callers that want the gate pass it themselves.
