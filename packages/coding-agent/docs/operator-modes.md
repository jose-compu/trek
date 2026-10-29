# Operator modes

An operator mode answers one question: who has to approve work before Trek acts?

The mode does not change the laws. A forbidden action stays forbidden in every mode. A free tool, such as `read`, runs in every mode. The difference is what happens to a **gated** tool, such as `bash`, and whether a whole phase may start.

Leaving the mode unset keeps today's behavior. `--diagnostic` is still the trace-only switch. `--operator-mode` selects one of the five modes for this process.

## The five modes

| Mode | Free tools (`read`, `grep`) | Web reads | Cheap tools (`write`, `edit`) | Gated tools (`bash`) | What it is for |
|---|---|---|---|---|---|
| **Supervised** | Run | Run if free, otherwise wait | Run | Wait for one confirmation | You are at the keyboard. A risky tool asks first. |
| **Delegated** | Run | Run if granted or free | Run | Run only if named in the grant | You already named the risky tools this task may use. |
| **Checkpoint** | Run, once act is open | Same, once act is open | Run, once act is open | Same as supervised, once act is open | You approve a phase, not every keystroke. The model does not answer until act is open. |
| **Diagnostic** | Run | Blocked unless the tool is free | Blocked | Blocked | You want the trace and no mutation. |
| **Ask** | Run | Run | Blocked | Blocked | You want an answer. Trek may read files and the web. It does not write. |

A confirmation is one shot. `confirmTool("bash")` allows the next `bash` call and then the wait returns. A grant is different: `grantTool("bash")` keeps `bash` authorized for the session, and only delegated mode uses it.

## Supervised

This is the careful default for a person watching the session. Cheap edits still run, because they are reversible. `bash` does not, until that one call is confirmed.

```bash
trek --operator-mode supervised
```

In the terminal, Trek asks `Run bash?` and shows the command. Yes runs that call. No leaves the block `Supervised mode: bash is gated and waits for confirmation.` `/confirm bash` allows the next bash call without asking. Print mode has no prompt, so a gated tool stays blocked unless a host calls `confirmTool`.

## Delegated

Use this when the task is already scoped. The grant is the list of gated tools that may run without a fresh confirmation. A gated tool that is not on the list still waits. Forbidden stays blocked.

```bash
trek --operator-mode delegated --operator-grant bash
```

`bash` runs. `git push` is not a separate tool; it is still a `bash` command, and the laws still refuse a destructive command unless destructive ops are allowed. The grant does not switch the laws off.

## Checkpoint

Checkpoint uses the supervised tool rule, and it also closes the **act** phase. Observe and intend still run, so the trace and the domain selection exist. The model does not get to call tools, and it does not answer, until the act phase is opened.

```bash
trek --operator-mode checkpoint
```

Every prompt then stops with:

```text
Error: Checkpoint: the act phase is closed. Open it before the agent runs.
```

That line is the mode working. It is not a missing key, a refused law, or a broken install. Trek recorded the turn and then refused to enter act, which is the phase where the model runs. The session has no `/` command that opens the phase. `approvePhase("act")` is a method on the session object for a host that embeds Trek. Once a host calls it, later prompts in that process enter act, and gated tools still follow the supervised rule.

In the terminal, quit and start again without `--operator-mode checkpoint`. An ordinary session leaves the mode unset, so act is open.

## Ask

Ask keeps the act phase open, so the model answers. That is the difference from checkpoint. Checkpoint stops before the model runs. Ask lets the turn run and then refuses a write.

`read`, `grep`, `find`, `ls`, and `recall` run. A web read also runs when the tool is named `webfetch`, `web_fetch`, `web-fetch`, `websearch`, `web_search`, or `web-search`. `write`, `edit`, and `bash` do not. `remember` and `forget` do not. A grant and `/confirm` do not open a write. The laws still apply to a read.

```bash
trek --operator-mode ask
```

A blocked tool says `Ask mode: write is blocked. This mode reads files and the web, and does not write.`

## Diagnostic

Diagnostic writes the trace and runs free tools only. `write`, `edit`, and `bash` are blocked. This is the same rule as `--diagnostic`.

```bash
trek --operator-mode diagnostic
trek --diagnostic
```

## What this slice does not include

A gated tool in supervised or checkpoint mode asks in the terminal before it runs. Delegated mode does not ask: a tool that is not in the grant stays blocked. Print mode has no prompt.
