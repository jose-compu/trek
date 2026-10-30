# Memory

Trek keeps a local semantic index on LogosDB. Before each model call, the latest user message is searched and the closest rows are appended to the system prompt. You do not have to call `recall` for that. `recall` is the same search, shown as a tool card.

The text sent to the model is plain. The card colors the layer, kind, tag, path, and line span. The passage stays in the tool-output color.

## Layers

A row in one store is not visible from another.

| Layer | Default | Location | Contents |
|---|---|---|---|
| Session | on | the session directory, under `memory/<session id>` | The question and answer for a turn, one thinking excerpt, and the compaction handoff |
| Project | on | `.trek/memory/` in the project (gitignored) | Lessons from `remember`, and indexed file chunks |
| Global | off | `~/.trek/memory/` | Nothing, until `memory.global` is true |

`/new` starts a session id, so session rows from the previous chat are not searched. Project lessons and file chunks remain.

A thinking row is the last non-redacted thinking block of that turn. Blocks under 40 characters, blocks that repeat the answer, and the signature token are not stored. The body is capped at 800 characters. Injection includes at most one thinking hit, and only when it scores at least as well as the weakest file or lesson already selected.

`/compact` writes a one-line handoff into the session store before the context is replaced.

## Commands

| Command | Effect |
|---|---|
| `/memory` | Layers, `topK`, whether an index is running, live chunk counts, and any included or excluded paths |
| `/memory index` | Reindex the project |
| `/memory add <path>` | Index that file or folder now, and keep indexing it. Gitignore does not apply to an added path |
| `/memory remove <path>` | Delete the chunks for that file or folder, and leave the path out of later reindexes |

```text
/memory add docs/catalog
/memory remove notes
```

A path must stay inside the project. `.git`, `node_modules`, `dist`, and `.trek` are refused.

`/memory` prints counts of live rows, not deleted ones. A store that does not exist yet is `0`.

## Tools

| Tool | Effect |
|---|---|
| `remember` | Store a lesson in the project layer. An optional tag is part of the text, not a separate index |
| `recall` | Search every enabled layer. Returns at most `topK` hits |
| `forget` | Delete the closest hit in `session`, `project`, or `global` |

Search embeds the query and a wider vector list, then reorders with weighted word overlap (half vector score, half lexical score). A tag such as `billing` can help a match. There is no lookup that returns a row only because the tag equals the query.

## What gets indexed

The project walk runs when the directory is not your home directory and not `/`, and it contains a marker such as `.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `CMakeLists.txt`, `Makefile`, or `.hg`.

Skipped directories: `.git`, `node_modules`, `dist`, `.trek`, `coverage`, `.next`, `target`. Skipped files: lockfiles, binaries, and files over 200 KB. Gitignore applies to the automatic walk. `/memory add` is the way to index a gitignored file.

One file cannot exceed 200 KB. Split a larger catalog into several files and add the folder.

A change is picked up by the watcher after a short debounce, and again at the end of a turn. The manifest skips a file whose size and modification time have not changed.

## Settings

Project `.trek/settings.json` overrides the global settings file.

| Setting | Default | Meaning |
|---|---|---|
| `memory.enabled` | `true` | `false` skips indexing, the watcher, embeddings, injection, and the memory tools |
| `memory.session` | `true` | Session store |
| `memory.project` | `true` | Project store |
| `memory.global` | `false` | Global store |
| `memory.topK` | `5` | Hits kept. Integer from 1 to 50 |

```json
{
  "memory": {
    "enabled": true,
    "session": true,
    "project": true,
    "global": false,
    "topK": 5
  }
}
```

Turning every layer off is the same as disabling memory.

`--memory off` does this for one process and does not write settings. `--memory on` turns the subsystem on for that process and still respects the layer flags.

Included and excluded paths are not settings. They are stored in `.trek/memory/paths.json`.

## Injection

The query is the latest user message, cut at 512 characters. Up to `topK` hits are appended, each cut at 400 characters. An empty query, a failed search, or memory that is off adds nothing, and the turn continues.

Lesson ids from that block are written on the audit step as `retrievedLessonIds`.

Embeddings are MiniLM (`Xenova/all-MiniLM-L6-v2`, 384 dimensions), loaded on first use. If the model cannot load, recall returns no hits and the turn continues. Tests use a fake embedder and do not download it.

A cross-encoder is allowed only for a local or hybrid Mistral, Mistral Pro, or Qwen suite. API mode and the LFM suite do not construct one. The session does not start a reranker process.

## Lessons

A stored lesson is L3. A lesson placed in the prompt is L2.

**Writing (L3).** After a turn with a tool error, a law block, or an EffortRegulator stop, the session model writes one lesson: when it applies, the mistake, and a rule for next time. A prompt that starts with a correction (`no`, `that is wrong`, `not what I asked`, `/undo`) writes a lesson about the previous turn before the answer. The lesson is stored in project memory, tagged with its domain, and recorded as a `trek:lesson` session entry. The call is outside the transcript and has no tools. A clean turn writes nothing.

**Promotion (L3 to L2).** Each prompt looks up the 20 nearest lessons in project and global memory, reranked where the suite allows it. The Frontier model, or Planning when Frontier is not assigned, picks up to five that apply. Only those lessons enter the prompt. An id it invents is dropped. The choice, the model, and the reason are recorded as a `trek:lesson_promotion` entry. When no lesson is found, no call is made. When the reply is not usable or no Planning or Frontier model is assigned, the lessons keep score order.

`TREK_LESSONS=0` stops writing lessons. `TREK_LESSON_PROMOTION=0` uses score order and makes no promotion call. `TREK_PROMOTION_MODEL=0` leaves L2 on score order and refuses L1. Memory that is off writes and promotes nothing.

**Crystallize (L2 to L1).** `/crystallize <id>` asks the Frontier model, or Planning when Frontier is not assigned, for a yes or a no. A no stops and names the reason. A yes shows the draft and waits. Yes writes `.trek/skills/lessons/<id>/SKILL.md`, which the next session loads. No handler, including print mode, writes nothing. A grant does not skip the Yes. `/crystallize remove <id>` moves that file into `history/`. `/lessons` lists the id, the domain, whether a skill is live, and the rule. Compaction keeps the user intent, the lesson ids, and the errors, and drops verbose tool output. The lesson ids are appended to the compaction summary and to a `trek:compaction` entry.
