# Implementation Flow Guide

How to execute an accepted plan inside a session topic: verify the plan, run tasks one by one, review each task, and close out.

Read this guide when creating a plan or starting plan execution. The topic skeleton (worktrees, guards, artifact registration) lives in `SKILL.md` — this guide covers only execution discipline and never duplicates CLI commands.

## Preconditions

- The spec passed the Determinism Gate and was accepted by the user.
- The plan exists: `artifact-create <topic> plan <spec-id>` produced `NN-<name>.plan.md` and `plan: open` in STATE.md.
- The topic worktree exists and `guard` returns `ok` (see Worktrees in `SKILL.md`).

Do not start execution while any precondition is missing.

## Plan quality checklist

Run this against the plan before the first task. Fix inline if any check fails.

- [ ] Every requirement in the spec maps to a task
- [ ] No TBD, TODO, or vague steps
- [ ] Names and types are consistent across tasks
- [ ] Each task is verifiable and self-contained
- [ ] Test/build commands are explicit with expected output
- [ ] Later tasks correctly reference earlier outputs
- [ ] All file paths are exact and consistent
- [ ] No tasks for unrequested features or premature abstractions
- [ ] Ambiguities were surfaced and resolved, not silently guessed
- [ ] Each task has explicit verification steps

## Task execution loop

For each task, in order:

1. Mark the task `in_progress` in the plan file.
2. Follow the task's steps exactly; do not improvise scope.
3. Run the task's verification command; the expected output must match.
4. Commit the task's changes (one commit per task).
5. Apply the review gate (next section).
6. Mark the task complete only after the review gate passes.

If a verification command fails, fix within the task's scope or stop and report. Never mark complete with a red check.

## Review gate per task

- **Self-review** only if **all** of the following are true:
  - ≤ 3 files touched
  - Net diff ≤ 30 lines
  - No API / signature changes
  - No state, concurrency, permissions, or error-handling changes
  - One clear verification command covers the change
- **Whole-diff review** for everything else, or whenever unsure: re-read the full task diff against the spec, then let the GitHub PR reviewer do the human review at handoff (see `pr-handoff`).

### Self-review checklist

- [ ] The diff fully covers the task
- [ ] No changes outside the plan
- [ ] No TBD/TODO comments, hard-coded values, or magic numbers
- [ ] Verification tests behavior, not just existence
- [ ] Obvious edge cases are handled

If any gate fails or you are unsure, stop and produce a task brief with the review package before continuing.

## Close out

1. `plan-status <topic> <spec-id> implemented`.
2. Update the STATE.md body in the same turn (progress, PRs, worktree status).
3. PR handoff via the `pr-handoff` skill (rebase, pre-push checks, PR, UAT) and register PRs with `pr-add`.

## Anti-patterns

- Writing plan or code in the main checkout
- Skipping the worktree because "the change is small"
- Writing code before the plan exists
- Starting execution before the plan checklist passes
- Accepting placeholders in the plan
- Adding features not in the spec
- Refactoring or reformatting code the change didn't touch
- Marking a task complete without running its verification
- Skipping the review gate because the user seems impatient
- Editing an already-finalized spec instead of creating a new numbered spec for follow-up work