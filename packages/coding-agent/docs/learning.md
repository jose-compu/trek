# Learning

A turn can split into parallel branches, leave a lesson, and become a skill only when you confirm.

## Branches

`spawn_branches` takes up to four subtasks. Each one runs with the parent summary and the same tools. The laws and the operator mode apply inside every branch. The first branch to write or edit a path owns it. Another branch that writes that path is blocked. Bash calls and confirm dialogs run one at a time. HALT stops every branch. `gather` returns the summaries in the order you name.

## Lessons

After a tool error, a law block, an effort stop, or a correction, the session model writes one lesson into project memory. The lesson has a trigger, a mistake, a rule, and a domain. A clean turn writes nothing.

On the next prompt, the Frontier model (Planning, when Frontier is not assigned) chooses up to five of the twenty nearest lessons. Those enter the prompt. An id that is not in the list is dropped.

`TREK_LESSONS=0` stops writing. `TREK_LESSON_PROMOTION=0` keeps score order and makes no promotion call. `TREK_PROMOTION_MODEL=0` does the same for that choice and refuses a skill.

## Skills

`/lessons` prints the stored lessons.

`/crystallize <id>` asks the same promotion model whether the lesson should become a skill. A no stops. A yes shows the draft and waits for Yes. The skill is `.trek/skills/lessons/<id>/SKILL.md` and loads on the next session. Print mode cannot approve. A delegated grant does not skip the Yes.

`/crystallize remove <id>` moves the skill file into `history/` under that folder.

Compaction is told to keep the intent, the lesson ids, and the errors, and to drop verbose tool output. The ids are also written on the compaction entry.
