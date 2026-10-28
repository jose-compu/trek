# Operator modes

An operator mode answers one question: who has to approve work before Trek acts?

The mode does not change the laws. A forbidden action stays forbidden in every mode. A free tool, such as `read`, runs in every mode. The difference is what happens to a **gated** tool, such as `bash`, and whether a whole phase may start.

Leaving the mode unset keeps today's behavior. `--diagnostic` is still the trace-only switch. `--operator-mode` selects one of the four modes for this process.

## The four modes

| Mode | Free tools (`read`, `grep`) | Cheap tools (`write`, `edit`) | Gated tools (`bash`) | What it is for |
|---|---|---|---|---|
| **Supervised** | Run | Run | Wait for one confirmation | You are at the keyboard. A risky tool asks first. |
| **Delegated** | Run | Run | Run only if named in the grant | You already named the risky tools this task may use. |
| **Checkpoint** | Run, once the phase is open | Run, once the phase is open | Same as supervised, once the phase is open | You approve a phase, not every keystroke. |
| **Diagnostic** | Run | Blocked | Blocked | You want the trace and no mutation. |

A confirmation is one shot. `confirmTool("bash")` allows the next `bash` call and then the wait returns. A grant is different: `grantTool("bash")` keeps `bash` authorized for the session, and only delegated mode uses it.

## Supervised

This is the careful default for a person watching the session. Cheap edits still run, because they are reversible. `bash` does not, until that one call is confirmed.

```bash
trek --operator-mode supervised
```

The block text is `Supervised mode: bash is gated and waits for confirmation.`

## Delegated

Use this when the task is already scoped. The grant is the list of gated tools that may run without a fresh confirmation. A gated tool that is not on the list still waits. Forbidden stays blocked.

```bash
trek --operator-mode delegated --operator-grant bash
```

`bash` runs. `git push` is not a separate tool; it is still a `bash` command, and the laws still refuse a destructive command unless destructive ops are allowed. The grant does not switch the laws off.

## Checkpoint

Checkpoint uses the supervised tool rule, and it also closes the **act** phase. Observe and intend still run, so the trace and the domain selection exist. The model does not get to call tools until the act phase is opened.

Opening act is `approvePhase("act")` on the session. It stays open for later prompts in that process. Intend and reflect are not closed in this slice. They are recorded, and the stop is before tools run.

The block text is `Checkpoint: the act phase is closed. Open it before the agent runs.`

## Diagnostic

Diagnostic writes the trace and runs free tools only. `write`, `edit`, and `bash` are blocked. This is the same rule as `--diagnostic`.

```bash
trek --operator-mode diagnostic
trek --diagnostic
```

## What this slice does not include

0.13 still has the rest of Guardrails+ outside this branch's first slice: one clarifying question, the tone profile, the anti-pattern check, guest safe mode, and a terminal prompt that asks for the confirmation in the TUI. The decision above is what the TUI will ask. Until that prompt exists, a gated tool without a confirmation or a grant is blocked and the reason says which mode stopped it.
