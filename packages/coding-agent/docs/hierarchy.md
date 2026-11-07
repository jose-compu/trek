# Hierarchy (model ladder)

Trek can run one API chat model, or a local / hybrid **ladder** of roles. Each turn starts as low as possible and **escalates** when the current role fails or asks for help.

## Modes

| Mode | Behavior |
| --- | --- |
| `api` | Factory `single`: one session Frontier. `layering: auto` with bound Workhorse climbs remote SKUs. No llama.cpp. Decision optional later via Liquid API. |
| `local` | Decision → Workhorse → Planning. Tooling is a runner. No Frontier. |
| `hybrid` | Same as local, plus Frontier (API) at the top. |

Configure with `trek models set-mode …`, `~/.trek/models.yaml`, project `.trek/models.yaml`, or `/hierarchy` (0.16). Pre-0.18 files with `mode: local` or `hybrid` and no `layering` key load as `manual` so the suite ladder stays intact.

## Layering (0.18)

`hierarchy.layering` is independent of `mode`. Factory default is **single**: one chat model on Workhorse. Extra roles (Tooling, Planning, Frontier, verifier) stay unbound until you opt in.

| Value | Behavior |
| --- | --- |
| `single` | One Workhorse. `/hierarchy single` and `trek models set-layering single` clear extra roles. |
| `auto` | `/hierarchy auto --catalog <file>` maps chat slots from that catalog (tags, thinking, price — not SKU names). One chat model stays `single`. Verifier and Decision stay unbound. Without `--catalog`, only the flag is stored. |
| `manual` | Suite extras plus any `/hierarchy role` or `trek models set-role` write. `--clear` unbinds one role so the suite preset cannot fill it. |

Role `thinking` is `off`, `brief`, or `deep`. YAML `true`/`on` still means deep; `false`/`off` means off. Frontier and verifier may use `source: local` or `lmstudio`. In `single`, local/hybrid resolve only Decision, Workhorse, embedding, and reranker — not Tooling, Planning, Frontier, or verifier. The climb is Workhorse ⇄ Planning ⇄ Frontier. Tooling is a delegate runner, not a rung.

`/hierarchy` and `trek models set-layering` write `~/.trek/models.yaml`. If the project has `.trek/models.yaml`, they also patch `hierarchy.layering` there so the project file cannot keep an older value after a successful command. Role bind, `--clear`, and `set-lmstudio` likewise patch the project file and set `layering: manual`.

`/hierarchy role <role> --clear` unbinds one extra role.

Frontier `source: local` starts llama-server like Planning. `source: lmstudio` uses the LM Studio endpoint. API Frontier stays hybrid/api only.

## Ladder

```
Decision  →  Workhorse  ⇄  Planning  ⇄  Frontier
 (d1)         (act)         (think)       (consult)
                ↓
             Tooling (runner)
```

1. **Decision** (0.16) — Liquid AI **d1** decision model. One forward pass, **zero generated tokens**. Classifies the turn: handle / route Scripts or Workhorse. Not a chat model; not started as llama-server.
2. **Workhorse** — Default Act model. Read-before-write enforced. Starts the climb after Decision.
3. **Planning** — Thinking / plan brief; may act after elevation. Read-before-write enforced.
4. **Frontier** — Deep debug, research, hard architecture. Unbound Frontier aliases Planning with deep thinking. Default is API (hybrid). `source: local` or `lmstudio` is allowed.
5. **Tooling** — Optional runner for search / logs / fetch / summarize. Workhorse or Planning **delegate** here. Decision never routes a user turn to Tooling.

**Policy:** new sessions and idle LFM/hybrid consoles park on **Decision** (footer shows d1). Generative work routes Decision → Workhorse. After a climb, the floor **sticks** for the same topic until a new topic, an escalate, or a descalate.

Climb on:

- Decision outcome `escalate` (or equivalent choice),
- explicit `{"escalate":"next"|"planning"|"frontier","why":"…"}`,
- soft “I am stuck…” phrases,
- **malformed tool arguments** (schema validation, e.g. `write` missing `path`) — climb on the first failure,
- repeated tool failures (two errors in a row),
- **first-prompt context overflow** only (tier too small for system+tools+task). Later prompts that fill the window compact instead of climbing.

Drop on:

- explicit `{"descalate":"next"|"workhorse"|"planning"|"decision","why":"…"}` (e.g. Planning handing a typo to Workhorse),
- soft “this is simple / hand off to workhorse” from the model,
- user `descalate`, `use workhorse`, `simpler model`, or `go back to decision`,
- **new topic** → Decision (then route to Workhorse for the new generative turn).

The console shows a discreet dim line: `↑ workhorse → planning · reason` or `↓ planning → workhorse · reason`. Context-size errors stay quiet (no provider dump).

**New topic / task reset → Decision (lowest):** before each bind, Trek runs `detectTopicReset` against the previous user task. A reset fires on:

- first prompt of a session,
- explicit cues (`new task`, `/new-topic`, `forget that`, `switching topics`, …),
- `{"new_topic":true}` from user or model (current tier can request the drop),
- `{"descalate":"decision"}`,
- done→new (prior turn closed with thanks/done, next is a new imperative),
- intent shift / low lexical overlap with no shared files.

Then: `↓ … → decision · <label>`, footer shows d1, then `↑ decision → tooling · route` for the generative turn. Same-topic follow-ups keep the climbed floor.

## Decision Models (LFM d1)

Purpose-built for classification, routing, and scoring ([Liquid Decision Models](https://docs.liquid.ai/lfm/models/decision-models)). One API / local call returns probabilities over a fixed set of outcomes.

| Model | Access | Trek use |
| --- | --- | --- |
| **d1-omni-600M** | Open weights ([HF](https://huggingface.co/LiquidAI/d1-omni-600M)) | **Default local Decision** (edge, text + optional image/audio) |
| **d1-3B** / **d1-2B** | Open weights | Stronger local Decision when the laptop allows |
| **d1-omni-2B** | Open weights | Local when audio routing matters |
| **d1.1** / **d1-ultra** | Liquid API | Hosted Decision when `hierarchy.mode` is api/hybrid and keys exist |

**Contract (0.16):** before Tooling is bound, the Decision Index runs (`runDecisionIndex`):

- Hosted path: Liquid API `d1.1` / `d1-ultra` when `LIQUID_API_KEY` is set (`choice` route + sentiment).
- Local heuristic path: solve clear **sentiment / yes-no** turns at Decision.
- **Invent path:** if no canned pack fits, Tooling drafts a creative Decision JSON template; Trek validates and applies it (Liquid or lexical fill). Card: `· decision · invent · …` then `· decision · solve · …`.

`solve` returns structured JSON **without** staying on the Tooling chat floor. Files, shell, and open generative work still **escalate** (`↑ decision → tooling · …`).

## Suite defaults (chat + Decision)

See the [Roadmap model suite table](../../../../ROADMAP.md#5-model-suite-reference). Chat GGUFs stay suite-specific (Mistral / Qwen / LFM). **Decision is always LFM `d1-omni-600M`**: Mistral, mistral-pro, and Qwen have no suite-native Decision model, so they reuse the same Liquid d1 weights as the LFM suite (overrideable in `models.yaml`).

| Role | mistral | mistral-pro | qwen | lfm |
| --- | --- | --- | --- | --- |
| **Decision** | LiquidAI/d1-omni-600M (shared LFM) | same | same | LiquidAI/d1-omni-600M |
| Tooling | Qwen3.5-0.8B | Qwen3.5-0.8B | Qwen3.5-0.8B | LFM2.5-350M |
| Workhorse | Ministral-3-3B-Instruct | Devstral-Small-2507 | Qwen3.5-4B | LFM2.5-1.2B-Instruct |
| Planning | Ministral-3-8B-Reasoning | Ministral-3-8B-Reasoning | Qwen3.5-9B | LFM2.5-8B-A1B |

```yaml
hierarchy:
  mode: hybrid
  suite: mistral   # or qwen / lfm / mistral-pro — Decision stays d1
  layering: single
roles:
  decision:
    source: local
    id: LiquidAI/d1-omni-600M
    thinking: off
  tooling:
    source: local
    id: Qwen3.5-0.8B
    thinking: off
```

## Related commands

- `trek models list|set-mode|set-suite|set-layering|set-role|set-lmstudio|benchmark`
- `/hierarchy` — in-session layering / mode / suite / role picker (0.16, layering in 0.18)

## Related tests

- Unit: `test/escalation-ladder.test.ts`
- Optional live GGUF matrix: `test/escalation-live.test.ts`
  - Batteries per suite/role: `escalate:next`, named planning/frontier, ambiguous
  - No-escalate battery: typo, arithmetic, yes/no, clear choice, one-liner code, path echo — model answers in-tier with no escalate JSON
  - Cross-role chain: Tooling → Workhorse on the same hard task
  - Filters: `TREK_ESCALATE_SUITE`, `TREK_ESCALATE_ROLE`, `TREK_LLAMA_MAX_BYTES`
  - Enable: `set -a && source ~/.trek/llama-live.env && set +a && unset PI_NO_LOCAL_LLM && export TREK_LLAMA_LIVE=1`
- Decision live (0.16): classify fixture prompts with `d1-omni-600M` when weights are present
