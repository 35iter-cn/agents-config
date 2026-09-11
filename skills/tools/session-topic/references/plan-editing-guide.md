# Plan Editing Guide

How to author and evolve a plan file. Execution discipline (task loop, review gates, close-out) lives in `implementation-flow-guide.md`.

## Task template (required for new plans)

```markdown
## T-3 <task title>
Status: open
AC: AC-1, AC-2
Verify: npm test -- refund.spec.ts

Free-form body: steps, notes, expected output.
```

- `Status`: `open | in_progress | complete`. `verify` checks the value set and that every `AC:` id exists in the paired spec.
- `AC`: acceptance criteria ids this task fulfills. Omit only for pure chore tasks — say so in the body.
- `Verify`: exact command plus expected output. A task without a runnable check is unfinished.
- Legacy plans are not backfilled; apply the template when a plan is materially revised.

## Progress truth

The plan is the ONLY place tracking done/not-done. The spec's `AC-N` list is the definition of done and never carries status, checkboxes, or percentages. Adding scope mid-implementation = a new task with a one-line source note; the spec changes only when a settled commitment changed (then: material revision flow).

## Completed tasks are immutable

Once `Status: complete` (verified + committed), the task's status, verification result, and commit linkage never change. Wording fixes are allowed.

- Undo / change of direction = a NEW task; mark the old one `superseded by T-x` (or `reverted by T-x`) and keep its record.
- A task not yet executed can be edited or deleted in place — nothing exists to revert.
- Never delete completed tasks; they are the readable truth, git is the mechanical history.

## Self-check

- [ ] Every task uses the template (Status / AC / Verify)?
- [ ] Every `AC:` id exists in the paired spec?
- [ ] No completed task was edited or deleted?
- [ ] Direction changes recorded as new tasks with supersede markers?
- [ ] One commit per task?