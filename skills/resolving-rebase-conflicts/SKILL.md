---
name: resolving-rebase-conflicts
description: >-
  Use when rebasing a feature branch onto origin/master or origin/main and
  encountering or anticipating merge conflicts. Triggered when the branch has
  diverged from the main branch with overlapping file changes, workflow
  modifications, lockfile updates, or dependency changes that will produce
  conflicts during rebase.
---

# Resolving Rebase Conflicts

Systematically resolve rebase conflicts: isolated dry-run → plan → execute → verify.

## When to Use

- Feature branch has fallen behind `origin/master` or `origin/main`, rebase needed before merge
- `git rebase` expected to produce conflicts (overlapping workflows, lockfiles, source files)
- User says "rebase" or "solve conflicts" in context of a diverged branch

**When NOT to use:** No conflicts expected (simple rebase/merge suffices), or user wants merge not rebase.

## Quick Reference

| Phase | Action | Outcome |
|---|---|---|
| 1. Determine LMB | `git fetch origin`, infer `origin/master` → `origin/main` | LMB ref |
| 2. Dry-run | `./scripts/dry-run-conflicts.sh [LMB] [BRANCH]` | Conflict report |
| 3. Analyze | Categorize each conflicted file | Resolution plan |
| 4. Confirm | Present plan, wait for user approval | Go-ahead |
| 5. Execute | `git rebase origin/$LMB` | Rebased branch |
| 6. Resolve | Apply plan per-file, `git add`, `git rebase --continue` | Clean rebase |
| 7. Verify | `./scripts/verify-no-conflicts.sh` + cleanup | Verified |

## Dry-run (HARD GATE)

**Never start `git rebase` before completing isolated merge analysis.** Always use a worktree to avoid polluting the user's working tree.

```bash
git fetch origin
# Check remote main in order: origin/master, origin/main
./scripts/dry-run-conflicts.sh [LMB] [FEATURE_BRANCH]
```

- `RESULT: clean` → safe to rebase directly, stop.
- `RESULT: conflicts` → proceed to analysis.

The script creates a detached-head worktree at `/tmp/dry-run-<timestamp>-<branch-name>` and performs `git merge --no-commit --no-ff`. No side effects on the original repo.

## Analyze Conflict Surface

Classify each conflicted file:

| Category | Typical files | Resolution strategy |
|---|---|---|
| **Lockfile** | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` | Discard both; regenerate from resolved `package.json`. Never hand-merge. |
| **Dependency manifest** | `package.json`, `Cargo.toml`, `pyproject.toml` | Merge tooling changes; keep higher dep versions unless branch explicitly downgrades. |
| **CI / Workflow** | `.github/workflows/*.yml` | Retain both sides: branch's tooling + LMB's feature additions. |
| **Source code** | `src/**/*.ts`, `src/**/*.tsx` | Analyze imports, signatures, logic. Prefer LMB's features; apply branch's refactors on top. |
| **Docs / Config** | `README.md`, `*.config.*` | Keep both unless they contradict. |

For each file, produce one-line resolution directive: `file.ts → keep LMB's new API param, apply branch's error-handling refactor`.

## Present Plan and Confirm

Format:

```
## Dry-run Conflict Report
**Base:** origin/<lmb>  **Branch:** <name>  **Conflicts:** <N>

| File | Category | Proposed resolution |
|---|---|---|
...
```

**User confirmation is mandatory.** Wait for explicit approval ("ok", "go", "proceed"). Silence does not count.

## Execute Rebase

```bash
cd "$ORIGIN"
git rebase "origin/${LMB}"
```

### Resolve conflicts goal-oriented

1. Read conflict markers. Do not mechanically pick "ours" or "theirs".
2. Apply the confirmed directive to produce correct merged content.
3. Lockfiles: delete and regenerate (`pnpm install`, `npm install`, etc.).
4. `git add <file>` after resolving.
5. `git rebase --continue` when all files in the current step are clean.

New conflicts in later rebase commits not present in dry-run: apply same category logic silently. Ask user only for ambiguous business logic choices (mutually exclusive features in same function body).

## Verify and Report

```bash
./scripts/verify-no-conflicts.sh
git worktree remove "$WORKTREE" 2>/dev/null || rm -rf "$WORKTREE"
```

Report to user:
- Rebase completed onto `origin/<lmb>`
- Top 5 commits now on branch
- Files requiring non-trivial manual merging
- Reminder: run tests/build before pushing

## Common Mistakes

- Starting real rebase before dry-run (violates hard gate)
- Running dry-run in the original working directory (pollutes user's tree)
- Hand-editing lockfile conflict markers instead of regenerating
- Mechanically picking "ours" or "theirs" without understanding the intent
- Interrupting user mid-rebase for routine decisions
- Waiting for user approval on new conflicts that follow the same category pattern
- Not fetching before computing merge-base (stale LMB)

## Red Flags

- `git rebase` invoked before dry-run completed
- Dry-run performed in working tree instead of isolated worktree
- User hasn't confirmed plan but starting rebase
- Lockfile conflict being manually edited
- Same file appears in both "ours" and "theirs" with mutually exclusive features (ask user)
- verify-no-conflicts.sh exits non-zero (remaining markers)

## Ask User Instead of Guessing

- LMB cannot be inferred (neither `origin/master` nor `origin/main`)
- Ambiguous business logic conflict (both sides implement mutually exclusive behavior)
- Branch intentionally removes a workflow step or dependency that LMB added
- Regenerating lockfile fails due to peer dependency incompatibilities

## Supporting Scripts

- `scripts/dry-run-conflicts.sh` — isolated merge dry-run in worktree
- `scripts/verify-no-conflicts.sh` — verify no conflict markers remain
