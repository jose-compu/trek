# Trek documentation

Trek **1.0.0-rc.10** is the release candidate on `release-1-0-rc1` (GitHub prerelease once `v1.0.0-rc.10` is tagged). The binary is `trek`. The stable tag is **0.20.8**. `@trek/coding-agent` is not on the npm registry, and `https://pi.dev/install.sh` does not install this release.

## Quick start

After `v1.0.0-rc.10` is tagged, download the archive for this candidate (or build from the branch until then). `releases/latest` is v0.20.8.

```bash
curl -fsSL -o trek.tar.gz https://github.com/jose-compu/trek/releases/download/v1.0.0-rc.10/trek-darwin-arm64.tar.gz
tar -xzf trek.tar.gz
export PATH="$PWD/trek:$PATH"
cd /path/to/your/project
trek
```

Swap the archive name for your machine (`trek-darwin-x64`, `trek-linux-x64`, `trek-linux-arm64`, `trek-windows-x64.zip`, `trek-windows-arm64.zip`). From a checkout: `npm install`, `npm run build`, `npx trek`.

Authenticate with `/login`, or set an API key such as `ANTHROPIC_API_KEY` before starting `trek`.

Moving from 0.20: [Upgrade to 1.0.0-rc.10](upgrade-1.0.md). First-run detail: [Quickstart](quickstart.md). One-page reference: `assets/cheatsheet-1.0.png` (source `assets/cheatsheet.html`). Pages below sometimes say `pi` for the upstream harness. The command in this distribution is `trek`.

## Start here

- [Quickstart](quickstart.md) - install, authenticate, and run a first session.
- [Upgrade from 0.20](upgrade-1.0.md) - what 1.0.0-rc.10 changes, and what it does not.
- [Using Trek](usage.md) - interactive mode, slash commands, context files, domains, and the CLI reference.
- [Providers](providers.md) - subscription and API-key setup for built-in providers.
- [Gemini free tier](gemini-free-tier.md) - AI Studio key, and the free model id that answered.
- [Containerization](containerization.md) - sandbox pi with OpenShell, Gondolin, or Docker.
- [Settings](settings.md) - global and project settings.
- [Keybindings](keybindings.md) - default shortcuts and custom keybindings.
- [Sessions](sessions.md) - session management, branching, and tree navigation.
- [Compaction](compaction.md) - context compaction and branch summarization.
- [Memory](memory.md) - session, project, and global stores, indexing, and `/memory`.
- [Operator modes](operator-modes.md) - supervised, delegated, checkpoint, and diagnostic.

## Customization

- [Extensions](extensions.md) - TypeScript modules for tools, commands, events, and custom UI.
- [Skills](skills.md) - Agent Skills for reusable on-demand capabilities.
- [Prompt templates](prompt-templates.md) - reusable prompts that expand from slash commands.
- [Themes](themes.md) - built-in and custom terminal themes.
- [Pi packages](packages.md) - bundle and share extensions, skills, prompts, and themes.
- [Custom models](models.md) - add model entries for supported provider APIs.
- [Hierarchy](hierarchy.md) - 0.18 layering (`single` / `auto` / `manual`). Climb is Workhorse ⇄ Planning ⇄ Frontier; Tooling is a runner.
- [Custom providers](custom-provider.md) - implement custom APIs and OAuth flows.

## Programmatic usage

- [SDK](sdk.md) - embed pi in Node.js applications.
- [RPC mode](rpc.md) - integrate over stdin/stdout JSONL.
- [JSON event stream mode](json.md) - print mode with structured events.
- [TUI components](tui.md) - build custom terminal UI for extensions.

## Reference

- [Session format](session-format.md) - JSONL session file format, entry types, and SessionManager API.

## Platform setup

- [Windows](windows.md)
- [Termux on Android](termux.md)
- [tmux](tmux.md)
- [Terminal setup](terminal-setup.md)
- [Shell aliases](shell-aliases.md)

## Development

- [Development](development.md) - local setup, project structure, and debugging.
- [Performance](performance.md) - 0.17 baselines, CI budgets, compact console, concurrent TUI sessions.
