# Trek Changelog

Release notes for `@trek/coding-agent`. Upstream Pi history lives in the parent repo `UPSTREAM.md` / Pi monorepo.

## [0.19.9] - 2026-11-09

### Changed

- Session, project, and global memory are on by default. A host CLI miss (`gh milestone`) is one global lesson; a later session or repo increments that row instead of writing a duplicate.

## [0.19.8] - 2026-11-09

### Fixed

- A short "Task done." is a subtask yield, not the original request. Remaining work continues. Working... stays until the pin will not inject another continue. A second idle wrap-up with no tools stops the loop.

## [0.19.7] - 2026-11-09

### Fixed

- An `edit` miss is one nearest-line card (`L80| …`), not a duplicated hit list. Quote drift (`'` vs `"`) still applies when the line is unique.
- A long-task pin stops when the original request is done. “Original request is complete” / “nothing left to run” unpins instead of injecting another continue.
- `script_edit` snapshot satisfies Law 1 (no unread refuse). A lone bash `sed -i` becomes the ⬡ card; mixed `sed -i` plus grep/git stays on bash. No “Use script_edit” error.

## [0.19.6] - 2026-11-09

### Fixed

- Internal long-task and layering continue prompts stay off the transcript. No grey user card, no pending `Follow-up:` dump. The dim `· workhorse · continue N` line remains.

## [0.19.5] - 2026-11-09

### Fixed

- Grok `Internal error during token parsing` after an edit: omit replayed `reasoning_content` on tool-call turns, sanitize outbound text, and drop thinking before retrying that error.

## [0.19.4] - 2026-11-09

### Fixed

- A bash `echo` of layering control JSON is not executed or painted. The dim `→ workhorse ⇄ tooling` / climb line remains. Assistant text still strips that JSON.

## [0.19.3] - 2026-11-09

### Fixed

- `sleep`, `gh pr checks --watch`, `gh run watch`, and poll loops wait for exit (cap 300s) instead of returning `Started in background` after 8s. Prefer `gh … --watch` over `sleep` loops. An explicit `timeout` on a non-server command also waits for exit. Servers still detach after 1.5s.

## [0.19.2] - 2026-11-09

### Fixed

- Long-task resume no longer shows the continue prompt as a grey user card (OSC 133 hop). Live slices stay on the dim `· workhorse · continue N` line.
- Continue prompts no longer include escalate/descalate/delegate JSON, so the model does not `echo` that control and loop.
- A keep-alive `continue` / `continue with tasks pls` keeps the pinned goal instead of replacing it.
- Control-JSON-only or bash-echo slices do not auto-resume when the floor did not move. Honesty cards stay off those slices.

## [0.19.1] - 2026-11-09

### Fixed

- EffortRegulator spent-budget no longer stops a long main turn after 48 tools. Ordinary `read` / `bash` / `edit` / `write` do not spend that budget. Nested `spawn_branches` work and the spawn tools themselves still do. Repeat, same-error, and no-progress stops are unchanged.

## [0.19.0] - 2026-11-09

### Added

- Unix kit PATH probe and `/tools unix`. Optional misses print skip. Never download.
- `script_edit` (ex / `vim -Es` / ed / sed). No TTY. Snapshot first. Auto fallback. BSD/GNU `sed -i`. Compact 1–4 line card.
- Bash refuses interactive vim/nano/emacs/pagers, `dd`, and `find -delete`. Redirects `sed -i` / `ex` / `vim -Es` to `script_edit`. Caps `xargs -P` at 4.
- Recipe YAML packs (`trek recipes [--tool X]`, `/recipes`). Optional sg/mlr skip when missing.
- Decision/Scripts route runs `replace X with Y in F` through `script_edit` with zero chat-model calls. Dry-run, diagnostic, operator gates, and Law 1 read-before-write still apply.

## [0.18.2] - 2026-11-08

### Fixed

- API stacks: after a Decision park (`↓ workhorse → decision · task changed`), bind emits `↑ decision → workhorse · route` and the footer follows the actor. Named Planning still climbs; “create a plan” stays Workhorse.
- Long tasks stay on Workhorse. Keep-going prompts (`continue`, `start building`, `until you complete`) skip the Decision park and pin an unlimited resume until the task is done or blocked. Live Decision `new-topic` no longer resets the ladder. The parent workflow tag no longer says “answer only this step”.
- Long-task resume still climbs, descalates, and delegates. Model `new_topic` does not park while pinned. Archon consult is held; after restore the same task continues. Layer continue prompts keep subtasks on the handoff floor.

## [0.18.1] - 2026-11-08

### Fixed

- Ladder control JSON (`{"descalate":…}`, LayerDecision escalate/delegate) is hidden in the console. The dim `↑` / `↓` / `→` line stays.
- Tooling no longer runs mute Archon `layer-tool-runners` nodes (search/logs/fetch/summarize). Live weather/grep uses bash.
- Internal step prompts collapse to `· <id>` with no grey bar. The model is not told “Archon”. Assistant replies no longer paint Terminal OSC 133 grey blocks. After `layer-escalate`, the turn continues on Planning with tools instead of stopping at steps-back.
- Layer-* handoff pins roles (Workhorse → Planning / Frontier) and rebinds that SKU. Labeled `goal/constraints/tried/evidence/open` briefs parse into the five-field handoff. Consult restores the prior floor.
- Archon DAGs honor `when:`, `trigger_rule`, `context`, `effort`, `output_format`, `output_type`, `allowed_tools`, bash `timeout`, and `loop` until/max_iterations. Layer-* and all twenty domain workflows declare those fields. `layer-route` branches with `when:`.
- Independent Archon waves run through cpa-agents `mapPar` (real overlap). A shared session agent stays sequential (`serialize`) so two prompts do not share one model. `layer-hypotheses` fans out three Workhorse theories in one wave.
- Explicit `Escalate to planning` stays on Planning. Deep keywords (debug, root cause) no longer skip to Frontier after the first bind.
- `layer-consult` continues on Frontier with a real consult, then restores the prior floor. Mute handoff JSON that echoes “Consult only” does not climb again.
- `descalate to tooling` binds the Tooling runner. It does not drop Workhorse to Decision. The word “descalate” in a handoff is not a soft ladder drop.
- Mute internal steps do not climb or drop the ladder. A parsed handoff brief survives the Planning climb.
- Honesty status is one card on the final reply. Internal workflow steps do not print it.
- Workflows keep the original user prompt at the top. Handoff JSON renders as labeled lines, not a raw object.
- After `descalate to tooling` / delegate, the footer stays on Tooling for that turn. Role bind no longer overwrites it back to Workhorse.
- Named climbs (`use planning`, `swith to planning`) bind that SKU. Soft intent uses the Decision chat SKU (`planning|tooling|workhorse|same-topic|new-topic`); Jaccard no longer drops the floor. Workhorse stays the actor unless the user names a climb, a tool fails, or live Decision returns `planning`.

### Added

- Static xAI Grok replies for the complex layering prompts (workhorse/tooling/planning/frontier). Explicit user `consult frontier` / `escalate to planning` climbs; “first do the Plan” still starts on Workhorse until the model emits escalate.
- Static Archon × subtask packs: hypotheses fan-out, escalate handoff join, parallel tool-runners, consult/descalate/finance compose. No live APIs.
- Prompts can move the session (`move to frontier`, `use planning`). API stacks skip local d1.
- `/hierarchy auto --catalog` binds Decision: `kind: decision` (Liquid d1, Qwen 4B) or the cheapest chat (Grok Fast, Luna, Haiku). Verifier stays unbound.
- Static xAI packs for descalate, new-topic haiku, Decision yes/no, and ladder-nav (`use planning`, `move to frontier`).

### Changed

- `/hierarchy` status is an aligned card: layering / mode / suite / file, then climb and runner lines, then Role / Source / Provider / Model / Think. Unset roles show `unset`.
- Layered API Workhorse is told bash can reach the network. Weather, URLs, and live facts auto-delegate to Tooling when that runner is bound. Capability follow-ups do not drop to Decision.
- `python -m http.server` (and other server-like bash) ignores `timeout: 8000` and `block_until_ms: 0` so the turn does not stay on Working... while the server runs.

## [0.18.0] - 2026-11-07

### Added

- Domain lessons stay typed when roles climb. Workhorse writes. Meta triggers `misroute|over_escalate|over_think|runner_miss|verifier_reject|budget_stop`. Recall injects into the acting role. L1 still needs confirm ([#189](https://github.com/jose-compu/trek/issues/189)).
- Domain DAG and `layer-*` compose on the same turn. Trace `workflow` and `layer_workflow`. Optional Archon node `role:`. `layering: single` stays 0.12 ([#188](https://github.com/jose-compu/trek/issues/188)).
- Mix-source: per-role `source` wins over `hierarchy.mode`. Mix-vendor verifier must be a different provider than Workhorse. Route/escalate JSONL (`trek:layer_route`) includes `source`. Remaining D26 fixture packs. `trek models benchmark --layering` writes `trek-layering-benchmark.json` from fixture traces (not a CI gate) ([#198](https://github.com/jose-compu/trek/issues/198)).
- `/thinking briefly|deep|off` pins short-think. Compact **thinking briefly** card (1–2 lines). `LayerDecision.thinking: brief` wins. `/thinking deep` restores the 0.17 card and skips the #108 floor. The 128-token floor remains otherwise ([#197](https://github.com/jose-compu/trek/issues/197)).
- Layer-* Archon workflows execute through cpa-agents. Join is one `layer_join`. `layering: single` and Kimi Swarm skip CPA ([#195](https://github.com/jose-compu/trek/issues/195), [#196](https://github.com/jose-compu/trek/issues/196)).
- `/hierarchy auto --catalog <file>` and `trek models set-layering auto --catalog <file>` fill slots from a tagged catalog. Heuristic uses tags/thinking/price, not compiled SKU names. One chat model stays `single`. Verifier and Decision stay unbound. Layered `api` climbs the mapped SKUs instead of collapsing to Frontier ([#194](https://github.com/jose-compu/trek/issues/194)).
- Climb is Workhorse ⇄ Planning ⇄ Frontier. Decision routes Scripts or Workhorse. Tooling is a delegate runner, not a rung. Unbound Frontier aliases Planning. Handoff brief on code-triggered climbs ([#193](https://github.com/jose-compu/trek/issues/193)).
- Typed `LayerDecision`, handoff brief, and `LayerSubtaskResult`. Vendor-safe JSON Schema (no `minLength`/`maxItems`). Bad JSON retries once then a safe Workhorse continue. Faux harness under `test/suite/layering/` ([#191](https://github.com/jose-compu/trek/issues/191)).
- Fourteen bundled `domains/meta/layer-*.yaml` Archon workflows. `/workflows` lists them beside domain DAGs. Parse tests only ([#192](https://github.com/jose-compu/trek/issues/192)).
- `hierarchy.layering`: `single` (factory default), `auto`, or `manual`. `/hierarchy auto|single` and `trek models set-layering`. Role thinking is `off|brief|deep`. Verifier role. Frontier may be local. Binding a role sets `manual`; `--clear` records `hierarchy.unbound` so the suite preset cannot refill that slot; `single` clears Tooling/Planning/Frontier/verifier ([#190](https://github.com/jose-compu/trek/issues/190)).

## [0.17.0] - 2026-11-07

### Added

- Performance baselines: `profile:tui` / `profile:rpc` `--json`, and `npm run profile:e2e` for a faux-provider first prompt and reflective-loop wall clock ([#113](https://github.com/jose-compu/trek/issues/113)).
- Performance docs: profile JSON shape, budgets, compact console, concurrent sessions ([#114](https://github.com/jose-compu/trek/issues/114)).
- Operator env: `TREK_MEMORY_LOCAL`, `TREK_MEMORY_DOWNLOAD`, `TREK_LLAMA_PORT_START` (usage, settings, performance).

### Changed

- Cold-start: defer TUI, highlight.js, extension loader, local llama/MLX, and subcommand graphs until they are needed. `trek --version` no longer loads the session stack ([#109](https://github.com/jose-compu/trek/issues/109)).
- Reflective loop: next cycle id comes from the latest checkpoint (or an in-memory sequence), not a full JSONL parse; bundled domain YAML is parsed once per process ([#110](https://github.com/jose-compu/trek/issues/110)).
- Session JSONL: skip the per-append assistant scan, keep the file descriptor for a write burst, and persist cycle+checkpoint in one write ([#111](https://github.com/jose-compu/trek/issues/111)).
- Performance budgets: CI fails when faux first-prompt, reflective-loop, or JSONL append time exceeds `test/performance-budgets.json`. Bump that file to accept a slower time ([#112](https://github.com/jose-compu/trek/issues/112)).
- Compact console cards by default: header plus a 0–3 line scrolling viewport (1 line when empty). `ctrl+o` restores full card chrome and output ([#169](https://github.com/jose-compu/trek/issues/169)).
- Compact TUI start hides the TREK AGENT banner; `ctrl+o` keeps it persistent with the full header and loaded resources ([#177](https://github.com/jose-compu/trek/issues/177)). The footer cwd line is `/path:trek-agent@X.Y.Z` ([#178](https://github.com/jose-compu/trek/issues/178)).
- Bash does not block the turn on a still-running command: after 8s (or as soon as it prints a listen/bind line) the process stays up and the tool returns a pid. `block_until_ms: 0` waits for exit. `timeout` still kills. Later server logs no longer crash Trek (`Cannot append to a finished output accumulator`).
- Lesson notices include a brief title from the stored rule (`✔ lesson project:1020 Avoid Verbose Output`) ([#171](https://github.com/jose-compu/trek/issues/171)).
- `jailbreak-from-tool-output` is narrow by default (ignores read/edit/write and quoted fixture text); a flag asks to mute for the session ([#170](https://github.com/jose-compu/trek/issues/170)).
- Several TUI sessions can run at once: API mode does not load MiniLM/ONNX; `llama-server` probes a free port from 18080 ([#175](https://github.com/jose-compu/trek/issues/175)).

## [0.16.1] - 2026-10-31

### Added

- Decision Index runs before Tooling: idle parks on Decision (d1); sentiment / yes-no and other structured turns can **solve** at Decision (`· decision · solve · …`) without binding Tooling ([#166](https://github.com/jose-compu/trek/issues/166), [#158](https://github.com/jose-compu/trek/issues/158)).
- Creative Decision JSON packs (`sentiment-pulse`, `tweet-weather`, `yes-no-coin`, `label-jar`, …) plus a default `route-ladder` compass ([#166](https://github.com/jose-compu/trek/issues/166)).
- When no canned pack fits, Tooling invents a Decision template, Trek validates it, then applies it (Liquid API or lexical fill) ([#167](https://github.com/jose-compu/trek/issues/167)).
- Bidirectional ladder: escalate and descalate (`{"descalate":…}`, soft hand-off, user `descalate` / `go back to decision`); floor sticks on the same topic ([#163](https://github.com/jose-compu/trek/issues/163)).
- Topic/task reset (`detectTopicReset`, `{"new_topic":true}`) drops sticky elevation back to Decision ([#164](https://github.com/jose-compu/trek/issues/164)).
- Malformed tool arguments (schema validation, e.g. `write` without `path`) escalate on the first failure ([#165](https://github.com/jose-compu/trek/issues/165)).
- Shared LFM Decision (`LiquidAI/d1-omni-600M`) across suites; Law 1 read-before-write skips Decision and Tooling.

### Changed

- New topic no longer always flashes Decision → Tooling; the Decision Index chooses solve vs escalate.
- `/new` inherits parent hierarchy config and re-activates the local Decision floor.

## [0.16.0] - 2026-10-31

### Added

- `/hierarchy` sets mode, suite, and one role in `~/.trek/models.yaml`. Frontier stays on the API. The next session reads the file. This command does not download weights or start llama.cpp.
- `trek models benchmark` writes `trek-benchmark.json` and prints tokens per second, tool-call latency, and memory when a probe measures weights that are already on disk. Missing weights stay skipped. The command does not download GGUF files or start llama-server.
- The bash tool suggests grep, sed, awk, rg, find, and jq recipes. They do not delete files, call a model, or use the network.
- Local and hybrid sessions climb Tooling → Workhorse → Planning → Frontier. A role may emit `{"escalate":"next"|tier,"why":"…"}`; soft stuck phrases and repeated tool failures also elevate. The console shows a dim `↑ from → to` line. Workhorse acts; Planning writes a think brief; Frontier (API) takes deep work. `trek models set-lmstudio` binds one or two models already loaded in LM Studio.
- Memory rerank uses MiniLM cross-encoder by default when a local suite is active.
- Hierarchy docs describe the Decision (LFM d1) tier under Tooling. The d1 Decision Index loader ships in a follow-up.

### Changed

- Undo, keep-all, dry-run, the shortcut bar, previous model, and tree-filter back use alt chords. Terminal.app dropped Shift on the old chords, so undo arrived as suspend. `shift+tab` is unchanged. `?` opens the same list as `/hotkeys`.
- Before a local session starts, Trek lists chat weights that are not on disk and downloads them only after a yes.
- A local model whose window is under 4096 tokens uses a short prompt, only read, write, edit, and bash, and compacts against that window. The reply reserve stays inside the window.
- LFM2.5 chat roles use an 8192-token floor when `TREK_LLAMA_CTX` is smaller. Compaction reserve and the kept tail stay inside that window.
- On this Mac the LFM planning model uses the MLX 4-bit snapshot. The smaller LFM roles stay on llama.cpp, because MLX does not force a tool call and those models then describe the call instead of making it.
- A local turn waits until the server has finished loading. The MLX planning request names the snapshot directory, not the GGUF file.
- Lesson promotion skips an extra side call on a local OpenAI server so the TUI does not sit on Working. Side calls use a 45s cap. OpenAI streams that end without finish_reason but with text still complete.

## [0.15.1] - 2026-10-31

### Fixed

- A request to fix, push, or unblock does not start the engineering review. That review quoted a rule and then refused tools, so a failed check was never read. A review that does not ask for a fix still runs, and it does not invent a rule or a debt.

## [0.15.0] - 2026-10-31

### Added

- A lesson belongs to one domain. Each of the twenty domains ships a pattern: categories, areas, severity, fields, promotion targets, a threshold, and what is never stored. `.trek/domains/<id>/lessons.yaml` replaces the bundled pattern. `/patterns` lists and edits that file. The first edit can be restored.
- The lesson is checked locally. A secret is not stored. A repeat raises the count and is not written again. One repair call runs only when the typed record is not usable.
- Recall uses a lesson only in its domain. Meta, AI, Security, and Engineering stay available. A lesson with no domain is unchanged.
- At the threshold the session offers a domain skill. `/crystallize` still waits for Yes. Yes writes `.trek/domains/<id>/skills/<target>.md` and loads it on the next session in that domain. Below the threshold the lesson stays a lesson. A 0.14 lesson with no category still writes `.trek/skills/lessons/<name>/SKILL.md`.
- `/lessons <domain>` lists that domain.

### Changed

- A workflow node calls a tool only when that node allows it. The earlier node reply is in the prompt. If there is none, the prompt says so.
- The prompt stays on screen when Working... appears.
- An Archon node card keeps the grey background. Rules are dim, labels use the accent, and values are lighter.

## [0.14.1] - 2026-10-30

### Changed

- The honesty line is a short status row. High is a green check, medium a yellow mark, low a red mark. A zero count stays dim. An assumption or an unverified claim is on its own line.
- A stored lesson prints one dim line under the answer.
- Working... appears when the prompt is accepted, before the lesson write and the promotion call.
- Shortcut keys, the git branch, and the model name use the theme accent. The rest of the footer stays gray. Context still turns yellow above 70% and red above 90%.

## [0.14.0] - 2026-10-29

### Added

- `spawn_branches` runs up to four independent subtasks in parallel. Each branch gets its summary only and the same tools, laws, and operator mode. A file written by one branch is claimed for that spawn. Bash calls and confirm dialogs run one at a time. HALT stops every branch. `gather` merges branch summaries in the order given.
- Lessons. After a turn with a tool error, a law block, or an effort stop, or after a correction, the session model writes one lesson into project memory. Each prompt, the Frontier model (Planning when Frontier is not assigned) picks up to five of the 20 nearest lessons for the prompt. An invented id is dropped. `TREK_LESSONS=0` and `TREK_LESSON_PROMOTION=0` turn the two steps off.
- `/crystallize <id>` asks that same model whether the lesson should become a skill. A no stops. A yes waits for you. Yes writes `.trek/skills/lessons/<id>/SKILL.md`, loaded on the next session. Print mode cannot approve, and a grant does not skip the Yes. `/lessons` lists them. `/crystallize remove <id>` keeps the file under `history/`. Compaction keeps the intent, the lesson ids, and the errors.

## [0.13.1] - 2026-10-29

### Added

- `/domains` and `/workflows` in a session. The list shows each domain, whether it is on, and the workflow name. Enable and disable use the same store as the CLI. Meta, AI, Security, and Engineering stay on. The command does not run a workflow.
- A workflow reply is checked against its nodes. A skipped node, or a fact that is not in the turn, is marked on that turn. The check does not post, edit, or run a tool.
- A prompt can create a domain workflow, edit one, or restore the previous version. The previous YAML is kept under `.trek/domains/<id>/history/`.
- Supervised mode asks before a gated tool. Yes runs that call. `/confirm bash` allows the next call.
- `--operator-mode ask` answers and may read files or the web. It does not write, edit, or run bash. Act stays open.

## [0.13.0] - 2026-10-28

### Added

- Operator modes for 0.13. `supervised` waits on a gated tool. `delegated` runs a gated tool named in `--operator-grant`. `checkpoint` keeps the act phase closed until it is opened. `diagnostic` remains trace-only. The laws are unchanged.
- A selected Archon workflow is called node by node. A prompt node is one model step. `$USER_MESSAGE` and `$id.output` are substituted once. A `loop` node is an object with `prompt`, `until`, and `max_iterations`. `command`, `script`, and `loop` still do not run.
- An ambiguous or destructive prompt asks one question and does not call the model. `--tone plain` changes wording and leaves law text unchanged. Repeating the same tool call three times is flagged as a loop.
- Telegram safe mode. An owner runs the agent. A guest may talk and gets no tools, no confirmations, and no model call when the text asks for a secret, a tool, or a rule change. A stranger is still ignored.

## [0.12.0] - 2026-10-28

### Added

- Domain workflows. Twenty Archon workflows ship with the package. Meta, AI, Security, and Engineering stay on. `trek domains` and `trek workflows` list, enable, disable, add, show, and run them.
- A detected workflow draws a green `workflow` call. Filled parameters are colored inside the call. The YAML sent to the model stays plain.

## [0.11.0] - 2026-10-28

### Added

- Memory release. Local memory on LogosDB. `remember`, `recall`, and `forget` use three stores: session, project (`.trek/memory/`), and global (off unless enabled). A project lesson is recalled by a later session in that repo. File chunks and thinking traces are embedded with a situating header. `/memory` shows the layers and the live chunk count in each store. `memory.enabled: false` or `--memory off` skips indexing, the watcher, and embeddings.
- `/memory add <path>` indexes a file or folder, including one that gitignore skipped. `/memory remove <path>` drops those chunks and leaves them out of later reindexes. `/memory` lists the included and excluded paths.

### Changed

- A recall card colors the layer, kind, tag, and file span. The passage stays in the tool-output color. The text sent to the model stays plain.

## [0.10.3] - 2026-10-28

### Added

- `/memory add <path>` indexes a file or folder, including one that gitignore skipped. `/memory remove <path>` drops those chunks and leaves them out of later reindexes. `/memory` lists the included and excluded paths.

## [0.10.2] - 2026-10-28

### Changed

- A recall card colors the layer, kind, tag, and file span. The passage stays in the tool-output color. The text sent to the model stays plain.

## [0.10.1] - 2026-10-28

### Added

- Local memory on LogosDB. `remember`, `recall`, and `forget` use three stores: session, project (`.trek/memory/`), and global (off unless enabled). A project lesson is recalled by a later session in that repo. File chunks and thinking traces are embedded with a situating header. `/memory` shows the layers and the live chunk count in each store. `memory.enabled: false` or `--memory off` skips indexing, the watcher, and embeddings.

## [0.10.0] - 2026-10-28

### Added

- `--effort off|normal|loose` and the `effort` setting. `loose` multiplies every effort stop by 10. `off` does not stop the turn for effort. Safety checks stay on.
- Independent reads, and edits of different files, run together. Edits of the same file stay in order. `trek processes` and `/processes` print parallel, sequence, guarded choice, and inversion, with the session seed, including a prompt that uses one tool at a time. A revert applies the inverse, then `.trek` history, then git.

## [0.9.1] - 2026-10-28

### Fixed

- An edit that already matches the file is not shown in the terminal.

## [0.9.0] - 2026-10-28

### Fixed

- A large `edit` call whose `edits` array arrives as a JSON string is parsed, including raw newlines. A cut-off payload keeps the complete replacements. The validation error no longer echoes the whole argument payload.
- An `edit` whose middle lines drifted still replaces the block when the first and last lines uniquely bound a region of similar size. Copied line-number prefixes are ignored. A miss quotes the current lines.
- An `edit` whose replacement already matches the file reports that no change is needed. It does not fail, and it does not blame special characters.
- Different edits of the same file are no longer treated as one edit. A turn may edit different files together. A second edit of the same file in that turn waits.
- An edit that puts back text already replaced in the same prompt is refused, including when that text sits inside a larger block. The latest command errors stay in that result.
- An edit that already matches the file is reported once. The same notice does not repeat.
- A failed command shows the located `error:` lines before the exit code. The same errors stop the turn, and so does the fourth failure of that command.

### Added

- `spawn_subtask` hands the child a summary only and aborts past depth 5. IntentionFilter repairs a summary that names no next action, then the turn continues.
- The live tool loop stops when the same action is used 4 times, the same error repeats 8 times, or the prompt uses its 48 tool calls. A new error, such as a failed build log, is progress. The result includes the EffortRegulator reason.
- Component routing from `routing.components` or the dynamic policy. Audit steps record the route reason. Workhorse is unchanged. A later Decision model such as Jev can use that slot.
- Short thinking traces (#108). Tool turns use reasoning effort `minimal` and a 128-token thinking budget. Local GGUFs get the cap in the prompt.

### Security

- `--approve` / `--no-approve` gate project `.trek` resources and ancestor `AGENTS.md` / `CLAUDE.md` files (GHSA-mqxh-6gq7-558m). Non-interactive runs do not load those files until a saved decision or `--approve`. Recorded in `UPSTREAM.md`.

## [0.8.1] - 2026-10-01

### Fixed

- Production dependencies: `brace-expansion` 5.0.12, `protobufjs` 7.6.6, `shell-quote` 1.11.0, and `undici` 8.11.2.

## [0.8.0] - 2026-09-30

### Added

- `trek models` for the 0.8.0 hierarchy. Default is `api` (no llama-server). `local` and `hybrid` opt in. Audit steps record the role and source.

### Changed

- A local role completes on `llama-server`. The saved API model is left unchanged. A missing GGUF does not fall back to the API.
- Pure local mode requires a tool for a build, run, or open request until a file tool and `bash` have both run.
- Honesty status is `honesty confidence=<level> assumptions=<n> unverified=<n>`. Trailing status chatter is omitted.
- `llama-server` stderr goes to `~/.trek/logs/llama-server.log`. The session stops the server on exit. A local completion stops after 120 seconds or 4,096 tokens.

## [0.7.5] - 2026-09-08

### Fixed

- Do not treat a missed oldText as already applied just because newText exists elsewhere. If DBODY is still in the file, retry edit.
- Re-run a cached edit when oldText is still on disk. Set replaceAll to change every occurrence instead of rewriting the file.

## [0.7.4] - 2026-09-08

### Fixed

- Failed edits are not cached, so a retry can run. Duplicate success says the change is already applied and must not be rewritten.
- If oldText misses but newText is already uniquely in the file, edit reports that and does not rewrite.

## [0.7.3] - 2026-09-08

### Fixed

- Edit matches when only indentation or tabs/spaces differ, and failed edits tell the model to retry instead of rewriting the file.
- Strip leftover `[idempotent]` prefixes from old tool results before they reach the model ([#96](https://github.com/jose-compu/trek/issues/96)).
- Do not cache bash in the same prompt. Re-running the same command after an edit must execute again.

## [0.7.2] - 2026-09-07

### Fixed

- Drop the `[idempotent]` prefix from duplicate write/edit/bash tool results so models see plain language, not a wrapper tag ([#96](https://github.com/jose-compu/trek/issues/96)).

## [0.7.1] - 2026-09-07

### Fixed

- Stop Grok 4.6 reasoning loops: honor thinking level via `reasoning_effort`, abort repeated thinking, and do not auto-retry that error ([#95](https://github.com/jose-compu/trek/issues/95)).

## [0.7.0] - 2026-09-01

### Added

- **Reproducibility policy** (`default` / `strict_audit`), session seed (default `42`, D5), and `trek:reproducibility` session JSONL record ([#70](https://github.com/jose-compu/trek/issues/70), [#75](https://github.com/jose-compu/trek/issues/75)).
- **Seed propagation** to seed-capable providers; Anthropic omits seed ([#71](https://github.com/jose-compu/trek/issues/71)).
- **Startup determinism warning** and `trek config reproducibility` ([#72](https://github.com/jose-compu/trek/issues/72), [#74](https://github.com/jose-compu/trek/issues/74)).
- **`trek:audit_step`** per LLM completion, including `system_fingerprint` when present ([#73](https://github.com/jose-compu/trek/issues/73)).
- **Audit acceptance gate** for same-seed tool intent, fingerprint, and `strict_audit` ([#76](https://github.com/jose-compu/trek/issues/76)).

### Changed

- Package version 0.7.0; CLI help documents `trek config reproducibility` and `TREK_SEED` ([#77](https://github.com/jose-compu/trek/issues/77)).

## [0.6.0] - 2026-08-27

### Added

- **Trace schema v1** (`trek:reflective_cycle`): timestamps, cycle id, tool names, laws pre/post ([#45](https://github.com/jose-compu/trek/issues/45)).
- **`trek trace list|show|diff`**: list cycle ids, show a cycle, diff intention vs outcome ([#46](https://github.com/jose-compu/trek/issues/46), [#48](https://github.com/jose-compu/trek/issues/48)).
- **`trek trace fork`** and cycle-boundary checkpoints (`trek:cycle_checkpoint`) ([#46](https://github.com/jose-compu/trek/issues/46), [#47](https://github.com/jose-compu/trek/issues/47)).
- **Diagnostic mode** (`--diagnostic` / `TREK_DIAGNOSTIC=1` / settings `diagnostic`) blocks mutating tools ([#49](https://github.com/jose-compu/trek/issues/49)).
- **`trek trace replay`** counterfactual stub: fork + patched observe ([#50](https://github.com/jose-compu/trek/issues/50)).
- **Trace test gate** (faux LLM): fork from cycle 5, laws pre/post, intention vs outcome, counterfactual observe ([#51](https://github.com/jose-compu/trek/issues/51)).
- **`trek telegram`**: long-poll Bot API, token/allowlists, isolated DM sessions ([#52](https://github.com/jose-compu/trek/issues/52), [#53](https://github.com/jose-compu/trek/issues/53)).
- **Telegram Groups** (mention/command) and `/confirm` gated destructive ops ([#54](https://github.com/jose-compu/trek/issues/54), [#55](https://github.com/jose-compu/trek/issues/55)).
- **Telegram media**: inbound photos/documents staged under `.trek/telegram/inbox/`; long replies split or sent as a file; group traces omitted; stickers/voice ack unsupported ([#56](https://github.com/jose-compu/trek/issues/56)).

### Changed

- README/CLI help document `trek trace` and `trek telegram` allowlists and group safety; package version 0.6.0 ([#58](https://github.com/jose-compu/trek/issues/58)).

## [0.5.1] - 2026-08-23

### Changed

- GitHub release binaries/archives renamed from `pi-*` to `trek-*`; compiled binary is `trek` / `trek.exe`.

### Added

- Pi plugin compatibility regression tests for Pi import shims and `trek` / `pi` manifest fallbacks ([#41](https://github.com/jose-compu/trek/issues/41)).

## [0.5.0] - 2026-08-22

### Added

- **`.trek` version store:** numbered diffs/snapshots and `manifest.json`.
- **`trek history` / `trek revert --prompt N|--step ID`.**
- **JSONL undo persistence** (`trek:edit_batch_checkpoint`) reloaded on session resume.
- **Bash `rm`/`mv` snapshots** for invertible path ops.
- **`--git-commit`:** optional labeled `trek: prompt #N` commits; refs stored in the manifest.
- **Idempotency** for duplicate write/edit/bash in the same prompt.

### Fixed

- Dry-run no longer populates the undo buffer.

## [0.4.0] - 2026-07-02

### Added

- **SafetyChecker + Laws:** pre-flight and post-flight enforcement; read-before-write; HALT honored at tool boundaries.
- **Reversibility tiers** and **multi-level undo** (Keep All, undo selector UI, `shift+ctrl+z` / `shift+ctrl+k`).
- **Dry-run** (`shift+ctrl+y`, `--dry-run`) and **sandbox** (`/sandbox`, `--sandbox`) for write/edit/bash.
- **Honesty protocol:** structured confidence and assumption ledger in final assistant output.
- **Reflective loop:** laws verdict and O→I→A→R fields on `trek:reflective_cycle` traces.
- **Output validation:** schema-mismatch notes appended to tool results.
- **CLI/TUI:** `--verbose` print mode; shortcut bar; ASCII banner.
- **Tests:** guardrails acceptance checklist (14 cases).

### Changed

- Guardrails run before extension `tool_call` hooks; extensions remain compatible with Pi packages (`trek install npm:<package>`).

## [0.3.0] - 2026-06-14

### Added

- **Reflective loop (O→I→A→R):** wraps each user prompt; Act phase uses existing agent/tool loop.
- **Component stubs:** WorldModel, IntentionFilter, OutputGuard, ToolExecutor, PolicyConstraints, EffortRegulator, Observer, FocusManager.
- **Meta-tools:** `observe()`, `reflect(scope)`; JSONL trace type `trek:reflective_cycle`.
- Disable with `TREK_REFLECTIVE_LOOP=0`.

## [0.2.1] - 2026-06-14

### Added

- **Prompt labels in TUI:** `#1`, `#2`, … on user messages and in the input editor (next prompt id).

### Fixed

- **Post-compaction resume:** auto-retry after context overflow no longer errors on assistant-last context.
- **Startup changelog:** filter entries above the running package version (no Pi `0.10.x` on Trek `0.2.0`).

### Changed

- **`TREK_*` env vars** with legacy `PI_*` fallback; user-facing Trek branding (docs partially Pi-branded).

## [0.2.0] - 2026-06-04

### Added

- **Prologue / constitution:** load `~/.trek/prologue.md` or project `.trek/prologue.md`; bundled project prologue in this repo.
- **Prompt numbering:** monotonic `#1`, `#2`, … markers in session JSONL (`prompt_meta` entries).
- **Batch CLI:** `trek --batch prompts.txt`, stdin pipe, and `--output jsonl`.
- **Debug mode:** `trek --debug` or `TREK_DEBUG=1` for gated internal logging.

## [0.1.0] - 2026-06-04

### Added

- **Genesis:** hard fork from Pi Coding Agent — Trek CLI, `@trek/*` packages, `~/.trek` config layout.
- Pi plugin compatibility shims and baseline build/test pipeline.
