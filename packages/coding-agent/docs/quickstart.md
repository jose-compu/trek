# Quickstart

This page gets you from install to a first `trek` session on **1.0.0-rc.9**. Coming from 0.20, read [Upgrade from 0.20](upgrade-1.0.md) first.

## Install

Download the GitHub release archive. `releases/latest` is the stable tag v0.20.8, not this candidate. `@trek/coding-agent` is not on npm.

```bash
curl -fsSL -o trek.tar.gz https://github.com/jose-compu/trek/releases/download/v1.0.0-rc.9/trek-darwin-arm64.tar.gz
tar -xzf trek.tar.gz
export PATH="$PWD/trek:$PATH"
trek --version
```

Use `trek-darwin-x64.tar.gz`, `trek-linux-x64.tar.gz`, `trek-linux-arm64.tar.gz`, `trek-windows-x64.zip`, or `trek-windows-arm64.zip` for the other builds. The zip is unzipped and run as `trek.exe`.

### Uninstall

Delete the unpacked `trek/` directory and remove it from `PATH`. That leaves settings, credentials, sessions, and installed packages in `~/.trek/agent/`.

Then start trek in the project directory you want it to work on:

```bash
cd /path/to/project
trek
```

## Authenticate

Pi can use subscription providers through `/login`, or API-key providers through environment variables or the auth file.

### Option 1: subscription login

Start pi and run:

```text
/login
```

Then select a provider. Built-in subscription logins include Claude Pro/Max, ChatGPT Plus/Pro (Codex), and GitHub Copilot.

### Option 2: API key

Set an API key before launching trek:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
trek
```

You can also run `/login` and select an API-key provider to store the key in `~/.trek/agent/auth.json`.

See [Providers](providers.md) for all supported providers, environment variables, and cloud-provider setup.

## First session

Once trek starts, type a request and press Enter:

```text
Summarize this repository and tell me how to run its checks.
```

By default, trek gives the model these built-in tools: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`, `remember`, `recall`, and `forget`. The core four are:

- `read` - read files
- `write` - create or overwrite files
- `edit` - patch files
- `bash` - run shell commands

Trek runs in your current working directory and can modify files there. Use git or `trek revert` if you want a way back.

## Give trek project instructions

Trek loads context files at startup. Add an `AGENTS.md` file to tell it how to work in a project:

```markdown
# Project Instructions

- Run `npm run check` after code changes.
- Do not run production migrations locally.
- Keep responses concise.
```

Trek loads:

- `~/.trek/agent/AGENTS.md` for global instructions
- `AGENTS.md` or `CLAUDE.md` from parent directories and the current directory

Restart trek, or run `/reload`, after changing context files.

## Common things to try

### Reference files

Type `@` in the editor to fuzzy-search files, or pass files on the command line:

```bash
trek @README.md "Summarize this"
trek @src/app.ts @src/app.test.ts "Review these together"
```

Images can be pasted with Ctrl+V (Alt+V on Windows) or dragged into supported terminals.

### Run shell commands

In interactive mode:

```text
!npm run lint
```

The command output is sent to the model. Use `!!command` to run a command without adding its output to the model context.

### Switch models

Use `/model` or Ctrl+L to open the model list. Use Shift+Tab to cycle thinking level. Ctrl+P cycles to the next model. Alt+P cycles to the previous model.

### Continue later

Sessions are saved automatically:

```bash
trek -c                  # Continue most recent session
trek -r                  # Browse previous sessions
trek --name "my task"    # Set session display name at startup
trek --session <path|id> # Open a specific session
```

Inside the session, use `/resume`, `/new`, `/tree`, `/fork`, and `/clone` to manage sessions.

### Non-interactive mode

For one-shot prompts:

```bash
trek -p "Summarize this codebase"
cat README.md | trek -p "Summarize this text"
trek -p @screenshot.png "What's in this image?"
```

Use `--mode json` for JSON event output or `--mode rpc` for process integration.

## Next steps

- [Using Trek](usage.md) - interactive mode, slash commands, sessions, context files, and CLI reference.
- [Providers](providers.md) - authentication and model setup.
- [Settings](settings.md) - global and project configuration.
- [Keybindings](keybindings.md) - shortcuts and customization.
- [Pi Packages](packages.md) - install shared extensions, skills, prompts, and themes.

Platform notes: [Windows](windows.md), [Termux](termux.md), [tmux](tmux.md), [Terminal setup](terminal-setup.md), [Shell aliases](shell-aliases.md).
