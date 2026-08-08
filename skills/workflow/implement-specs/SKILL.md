---
name: implement-specs
description: Implement an existing spec end-to-end using the superpowers pipeline. Use when the user has a written spec or requirements document and wants it implemented with worktree isolation, planning, review, and execution in this session. Requires superpowers skills to be installed.
---

# implement-specs

Take a spec from document to working code using the superpowers workflow.

## Dependencies

Requires these skills to be available:

- `superpowers:using-git-worktrees`
- `superpowers:writing-plans`
- `superpowers:executing-plans`
- `superpowers:requesting-code-review`
- `superpowers:finishing-a-development-branch`
- `superpowers:test-driven-development`
- `karpathy-guidelines`

## Process

Each stage is a hard gate. Do not proceed until it is complete.

### Stage 0 — Isolated workspace

Run `superpowers:using-git-worktrees`. If not already in a linked worktree, create one. All planning and implementation happen inside the worktree; never touch the main checkout.

### Stage 1 — Write plan

Run `superpowers:writing-plans` with the spec. Save the plan to disk before continuing. Surface assumptions explicitly; ask before guessing.

### Stage 2 — Review plan

Check the plan against the original spec. Fix inline if any check fails.

- [ ] Every requirement maps to a task
- [ ] No TBD, TODO, or vague steps
- [ ] Names and types are consistent across tasks
- [ ] Each task is verifiable and self-contained
- [ ] Test commands are explicit with expected output
- [ ] Later tasks correctly reference earlier outputs
- [ ] All file paths are exact and consistent
- [ ] No tasks for unrequested features or premature abstractions
- [ ] Ambiguities were surfaced and resolved, not silently guessed
- [ ] Each task has explicit verification steps

### Stage 3 — Execute plan

Run `superpowers:executing-plans` in this session.

For each task:

1. Mark `in_progress`.
2. Follow the steps exactly and run the verification command.
3. Commit the task's changes.
4. Decide the review path:
   - **Self-review** only if **all** of the following are true:
     - ≤ 3 files touched
     - Net diff ≤ 30 lines
     - No API / signature changes
     - No state, concurrency, permissions, or error-handling changes
     - One clear verification command covers the change
   - **Reviewer subagent** for everything else, or whenever you are unsure.
5. Self-review checklist:
   - [ ] The diff fully covers the task
   - [ ] No changes outside the plan
   - [ ] No TBD/TODO comments, hard-coded values, or magic numbers
   - [ ] Verification tests behavior, not just existence
   - [ ] Obvious edge cases are handled
6. If any gate fails or you are unsure, use `superpowers:requesting-code-review` with a task brief and review package.
7. Mark complete only after review passes.

After all tasks:

- Generate whole-branch review package.
- Dispatch final reviewer.
- Address any findings.
- Use `superpowers:finishing-a-development-branch`.

## Anti-patterns

- Writing plan/code in main checkout
- Skipping worktree because "change is small"
- Writing code before plan exists
- Starting execution before review passes
- Accepting placeholders in plan
- Adding features not in spec
- Refactoring or reformatting code changes didn't touch
- Marking task complete without running verification
- Skipping review because user seems impatient
