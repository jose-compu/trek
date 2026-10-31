# Hierarchy (model ladder)

Trek can run one API chat model, or a local / hybrid **ladder** of roles. Each turn starts as low as possible and **escalates** when the current role fails or asks for help.

## Modes

| Mode | Behavior |
| --- | --- |
| `api` | Single session Frontier (configured provider). No llama.cpp. Decision optional later via Liquid API. |
| `local` | Decision → Tooling → Workhorse → Planning. No Frontier. |
| `hybrid` | Same as local, plus Frontier (API) at the top. |

Configure with `trek models set-mode …`, `~/.trek/models.yaml`, project `.trek/models.yaml`, or `/hierarchy` (0.16).

## Ladder

```
Decision  →  Tooling  →  Workhorse  →  Planning  →  Frontier
 (d1)         (tools)      (act)         (think)      (API deep)
```

1. **Decision** (0.16) — Liquid AI **d1** decision model. One forward pass, **zero generated tokens**. Classifies the turn: handle / route / escalate. Not a chat model; not started as llama-server.
2. **Tooling** — Small generative model for mechanical tool calls (`read` / `bash` / simple edits).
3. **Workhorse** — Default Act model for builds and multi-step tool work.
4. **Planning** — Thinking / plan brief; may act after elevation.
5. **Frontier** — Hybrid only. Deep debug, research, hard architecture.

Climb on:

- Decision outcome `escalate` (or equivalent choice),
- explicit `{"escalate":"next"|"tooling"|"workhorse"|"planning"|"frontier","why":"…"}`,
- soft “I am stuck…” phrases,
- repeated tool failures.

The console shows a discreet dim line: `↑ tooling → workhorse · reason`.

## Decision Models (LFM d1)

Purpose-built for classification, routing, and scoring ([Liquid Decision Models](https://docs.liquid.ai/lfm/models/decision-models)). One API / local call returns probabilities over a fixed set of outcomes.

| Model | Access | Trek use |
| --- | --- | --- |
| **d1-omni-600M** | Open weights ([HF](https://huggingface.co/LiquidAI/d1-omni-600M)) | **Default local Decision** (edge, text + optional image/audio) |
| **d1-3B** / **d1-2B** | Open weights | Stronger local Decision when the laptop allows |
| **d1-omni-2B** | Open weights | Local when audio routing matters |
| **d1.1** / **d1-ultra** | Liquid API | Hosted Decision when `hierarchy.mode` is api/hybrid and keys exist |

**Contract (0.16):** before Tooling is bound, Decision answers at least:

- `noul` — needs generative tools / further tiers?
- `choice` — next action in `{solve, tooling, workhorse, planning, frontier}` (availability filtered by mode).

`solve` may short-circuit trivial routing answers. Anything that needs files or shell **escalates to Tooling** (then the generative ladder continues).

## Suite defaults (chat + Decision)

See the [Roadmap model suite table](../../../../ROADMAP.md#5-model-suite-reference). Chat GGUFs stay suite-specific (Mistral / Qwen / LFM). Decision defaults to **d1-omni-600M** across suites unless overridden in `models.yaml`:

```yaml
hierarchy:
  mode: hybrid
  suite: lfm
roles:
  decision:
    source: local
    id: LiquidAI/d1-omni-600M
    thinking: false
  tooling:
    source: local
    id: LFM2.5-350M
    thinking: false
```

## Related commands

- `trek models list|set-mode|set-suite|set-role|set-lmstudio|benchmark`
- `/hierarchy` — in-session mode / suite / role picker (0.16)

## Related tests

- Unit: `test/escalation-ladder.test.ts`
- Optional live GGUF matrix: `test/escalation-live.test.ts`
  - Batteries per suite/role: `escalate:next`, named planning/frontier, ambiguous
  - No-escalate battery: typo, arithmetic, yes/no, clear choice, one-liner code, path echo — model answers in-tier with no escalate JSON
  - Cross-role chain: Tooling → Workhorse on the same hard task
  - Filters: `TREK_ESCALATE_SUITE`, `TREK_ESCALATE_ROLE`, `TREK_LLAMA_MAX_BYTES`
  - Enable: `set -a && source ~/.trek/llama-live.env && set +a && unset PI_NO_LOCAL_LLM && export TREK_LLAMA_LIVE=1`
- Decision live (0.16): classify fixture prompts with `d1-omni-600M` when weights are present
