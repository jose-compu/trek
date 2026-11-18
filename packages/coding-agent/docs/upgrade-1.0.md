# Upgrade from 0.20 to 1.0.0-rc.5

`1.0.0-rc.5` is a GitHub prerelease on branch `release-1-0-rc1` (merge `78a153e`). The stable line is **0.20.8** on `release-0-20`. This page is the migration note for that candidate. It is not a final `v1.0.0` changelog.

## Install

Download the archive from the [v1.0.0-rc.5](https://github.com/jose-compu/trek/releases/tag/v1.0.0-rc.5) release. `releases/latest` is **v0.20.8**, because the candidate is a prerelease.

```bash
curl -fsSL -o trek.tar.gz https://github.com/jose-compu/trek/releases/download/v1.0.0-rc.5/trek-linux-x64.tar.gz
tar -xzf trek.tar.gz
export PATH="$PWD/trek:$PATH"
trek --version
```

Swap the archive name: `trek-darwin-arm64.tar.gz`, `trek-darwin-x64.tar.gz`, `trek-linux-x64.tar.gz`, `trek-linux-arm64.tar.gz`, `trek-windows-x64.zip`, `trek-windows-arm64.zip`. The archive unpacks to a `trek/` directory. Keep that directory together. The binary is `trek/trek` (`trek.exe` on Windows).

`@trek/coding-agent`, `@trek/ai`, `@trek/agent-core`, and `@trek/tui` are not on the npm registry. Do not install 1.0 with `npm install -g`.

From a checkout of this repo:

```bash
npm install
npm run build
npx trek --version
```

## What you keep

No settings migration. These paths are the same as 0.20:

- `~/.trek/agent/` for settings, auth, and sessions
- `~/.trek/models.yaml` and a project `.trek/models.yaml`
- `~/.trek/agent/trek-debug.log` for `trek --debug` / `TREK_DEBUG=1`
- Project `.trek/` for memory, domains, lessons, and file versions

Replace the binary directory. Leave `~/.trek` and the project's `.trek` in place.

The binary name stays `trek`. `PI_*` environment variables that 0.20 accepted are still accepted where the code calls `trekEnv()`.

## What changed since 0.20.4

The candidate and the 0.20.5–0.20.8 stable patches share three fixes. `packages/coding-agent/src/utils/debug-redact.ts` and `packages/coding-agent/src/core/domains/select.ts` match `v0.20.8`. The `edit` anchor does not.

| Change | 0.20.8 | 1.0.0-rc.5 |
|---|---|---|
| Debug log redacts `--api-key`, `--token`, `--password`, `--secret`, and `=value` forms, plus `sk-` / `sk-ant-` / `sk-or-v1-` / `xai-` / `ghp_` / `hf_` / `gsk_` / `csk-` shapes, Bearer tokens, and object keys such as `api_key` and `authorization` | yes (0.20.5) | yes (rc.2) |
| A turn that says write, edit, update, or replace and names a file with an extension does not enter a domain workflow | yes (0.20.8) | yes (rc.4) |
| Three-line `edit`: unique first line, third line two file lines below, middle line may differ | yes (0.20.6) | yes (rc.5) |
| Three-line `edit` across one blank line (third line three file lines below, and a blank line between the anchors) | yes (0.20.7) | no |
| Science workflows beyond `method-check` | no | yes (rc.3) |
| `trek bench run` | no | yes (rc.4) |
| Planning brief skipped when Planning and Workhorse are the same model | no | yes (rc.4) |
| One-shot shell requests stay on Act | no | yes (rc.4) |
| xAI id `grok-4.1-fast` | no | yes (rc.4, `@trek/ai`) |

### Science catalog

Science can be turned off. It is not one of Meta, AI, Security, and Engineering. The bundled workflows are `method-check`, `write-paper`, `review-paper-coauthor`, `review-paper-referee`, `respond-to-reviews`, `write-rebuttal`, `generate-slides`, `generate-poster`, `polish-bibtex`, `check-latex-build`, `figure-pass`, `extract-claims`, and `write-abstract`. Terms and per-workflow phrases are in `packages/coding-agent/domains/science/domain.json`. Leakage and train/test-split fact holds apply only when the selected workflow is `method-check`.

### Named-file writes

`turnNeedsTools` is true when the prompt matches `write|edit|update|replace` and a filename with an extension within 80 characters, or when it matches fix, push, blocked, unblock, or "what is happening" / "what happened". `selectDomain` then returns no workflow, so the tool loop runs. A prompt that only mentions a p-value and also says `write result.txt` is not held as `method-check`.

### Edit

For an `oldText` of at least three non-empty lines, the anchor applies only when the first line's match key is unique and at least 12 characters, and the last line sits on a small window around that snippet. The three-line case requires the third line to be exactly two file lines below the first (`start + 2`). The middle line is not required to match. Empty lines are dropped before the line count, so a blank line inside `oldText` is not one of the three lines. On `v0.20.8`, if `start + 2` misses, the matcher also accepts `start + 3` when a blank line sits between the anchors. That second accept is not in rc.5.

Match keys trim leading whitespace, collapse repeated spaces and tabs, and treat `'` as `"`.

### Bench

`trek bench run` prints the checked-in pack and does not call a model. `trek bench run --live` calls xAI and needs `XAI_API_KEY` or a `.env` in the working directory. This is not `trek models benchmark`.

```text
trek bench run [--live] [--lever single|auto|both] [--profile same|climb|fan] [--task id] [--timeout ms] [--out file]
```

`--profile same` uses `grok-4.3` on every role. `--profile climb` compares `grok-4.20-0309-non-reasoning` alone with that floor plus `grok-4.7` on Planning and Frontier. `--profile fan` compares `grok-4.7` alone with `grok-4.7` on Planning and Frontier and `grok-4.20-0309-non-reasoning` on Workhorse. The pack task `fan-headings` asks for `spawn_branches`, one branch per file, and no edit in the parent turn.

### Routing

`selectThinkRole` returns no planning brief when Workhorse and Planning share the same model id and provider (`provider`, or `source` when provider is unset). `isOneShotShell` classifies a prompt of at most 280 characters that mentions a directory, `mkdir`, `rmdir`, a sum, a printed number sequence, or trimming the last N characters, and that does not mention an app, website, game, project, scaffold, refactor, server, library, or package. `classifyTask` marks that prompt Act. When bash is available, the system prompt tells the model to run bash and to keep the command's stdout exact.

## What this candidate does not include

- A final `v1.0.0` tag
- npm packages
- Multilingual embeddings (0.21, issue 289)
- The 1.1 faux-pack CI gate, confirm-gated bench lessons, and a locked score baseline (issues 292–298)
- `assets/cheatsheet-1.0.png` (the tree has `assets/cheatsheet-0.18.png`)
- The 0.20.7 blank-line `edit` anchor

## Rollback

Install [v0.20.8](https://github.com/jose-compu/trek/releases/tag/v0.20.8) the same way, using that tag in the download URL. Settings and sessions do not need a reverse migration. You lose the science catalog, `trek bench`, the planning-brief skip, and the one-shot shell classification. You gain the blank-line `edit` anchor.
