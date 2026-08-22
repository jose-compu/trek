# Trek Agent

Trek is a **hard fork of the [Pi Coding Agent](https://pi.dev/)** — the minimal terminal coding agent with read, bash, edit, write tools, sessions, and a TypeScript extension ecosystem.

Pi optimizes for simplicity and adaptability: you extend it with plugins rather than inheriting a heavy built-in stack. Trek keeps that surface — CLI ergonomics, Pi packages, and extension APIs — and adds a **staged roadmap** toward a production-grade agent with explicit safety, determinism, memory, domain-specific workflows, and local model routing.

**What Trek adds (roadmap-driven):**

| Layer | Goal | Releases |
|---|---|---|
| **Safety** | Laws hierarchy, HALT, read-before-write, honesty protocol, dry-run, sandbox, undo | **0.4.0 Guardrails** → 0.13.0 Guardrails+ |
| **Undo** | `.trek` file versions, `trek history` / `trek revert`, labeled git commits | **0.5.0 Undo** (current) |
| **Determinism** | Full O→I→A→R traces, replay, seed logging, honest reproducibility limits | 0.6.0 Trace → 0.7.0 Audit |
| **Memory** | Session / project / global layers with incremental indexing | 0.11.0 Memory |
| **Domain workflows** | Per-domain skills and predictable [Archon](https://github.com/coleam00/Archon) workflows (Meta, AI, Security always on; optional domains toggled in config); auto-selection during **Intend**; `trek domains` / `trek workflows` | 0.12.0 Domains |
| **Local model hierarchy** | Tooling → work-horse → planning tiers, llama.cpp runtime, per-component routing | 0.8.0 Runtime → 0.9.0 Routing |

Every user turn follows **Observe → Intend → Act → Reflect** (O→I→A→R). Safety checks wrap **Act**; during **Intend**, the tooling tier picks a domain-specific workflow for the task at hand; traces and audit metadata accumulate over time so behavior is inspectable, not opaque.

Pi compatibility is preserved: community packages from [pi.dev/packages](https://pi.dev/packages) install with `trek install npm:<package>`. See [Pi Coding Agent plugins](#pi-coding-agent-plugins) below.

**Version:** 0.5.0 — see [CHANGELOG.md](./CHANGELOG.md). Full plan: [ROADMAP.md](../ROADMAP.md).

## Status

**0.5.0 Undo** shipped — durable `.trek/` history, `trek history` / `trek revert`, session JSONL checkpoints, optional labeled git commits. Next: **0.6.0 Trace**. Artifact files under `.trek/versions/` are local history (keep them out of git; labeled commits are the git undo layer).

## Quick start

```bash
cd trek
npm install
npm run build
npx trek --help
```

Config and sessions live under `~/.trek/agent/` by default.

## Pi Coding Agent plugins

Trek keeps Pi’s extension ecosystem. Existing Pi plugins and packages work without rewrites.

- **npm/git packages** — install with Trek’s package manager (not plain `npm install`):

  ```bash
  trek install npm:pi-agent-extensions
  trek list
  trek remove npm:pi-agent-extensions
  ```

- **Single-file extensions** — `trek -e ./my-extension.ts` or drop files in `~/.trek/agent/extensions/`.
- **Pi manifests** — `package.json` `"pi": { "extensions": [...] }` is honored (same as `"trek"`).
- **Pi imports** — `@earendil-works/pi-*` and `@mariozechner/pi-*` resolve to Trek packages via virtual module aliases.

See [UPSTREAM.md](./UPSTREAM.md) and [packages/coding-agent/docs/packages.md](./packages/coding-agent/docs/packages.md) for details.

## Upstream

See [UPSTREAM.md](./UPSTREAM.md) for the pinned Pi commit and rename map.

## License

MIT — see [LICENSE](./LICENSE).
