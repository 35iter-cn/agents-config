---
name: rebasing-diverged-branch
description: Use when rebasing a diverged feature branch onto main, encountering or anticipating merge conflicts from overlapping changes, lockfiles, or workflow modifications.
---

# Rebase Diverged Branch

Dry-run → plan → rebase → verify. Never rebase without dry-run.

## When to Use

- Branch diverged from main, rebase needed before merge
- `git rebase` expected to produce conflicts
**Not for:** No conflicts expected, or user wants merge.

## Quick Reference

1. **Fetch + dry-run**: `git fetch origin` → `./scripts/dry-run-conflicts.sh [LMB]`
2. **Analyze**: categorize each conflicted file
3. **Confirm**: present plan, **wait for user approval**
4. **Rebase**: `git rebase origin/$LMB`, resolve per plan
5. **Verify**: `./scripts/verify-no-conflicts.sh`, cleanup

## Conflict Categories
| Category | Strategy |
|---|---|
| **Lockfile** | Delete, regenerate. Never hand-merge. |
| **Dependency manifest** | Merge tooling; prefer higher versions. |
| **CI/Workflow** | Retain both sides. |
| **Source code** | Prefer LMB's features; apply branch's refactors on top. |
| **Docs/Config** | Keep both unless contradictory. |

## Execute
**Hard gate:** Dry-run in isolated worktree first. `clean` → skip rebase.
**If conflicts:** `git rebase origin/$LMB`. Apply plan per-file: `git add`, `git rebase --continue`.
New conflicts not in dry-run: same logic silently. Ask user for ambiguous business logic (mutually exclusive features in same function).

## Verify
```bash
./scripts/verify-no-conflicts.sh
```
Report LMB, top commits, non-trivial merges, remind tests.

## Pitfalls & Scripts

- Rebase before dry-run (gate violation)
- Hand-edit lockfiles → regenerate
- Stale LMB (fetch first)
- `scripts/dry-run-conflicts.sh` + `verify-no-conflicts.sh`
