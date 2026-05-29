---
name: keep-branch-fresh
description: Use when rebasing, syncing branch, or updating to latest main. Rebase a feature branch onto the latest main branch with safety guarantees.
---

## Overview

Safely rebase a feature branch onto the latest main branch (LMB).

## When to Use

- Feature branch is behind `origin/main` or `origin/master` and needs a fast-forward/rebase
- User asks to rebase, sync, or update a branch to the latest main

## Quick Reference

### Scripts

| Step    | Command                                                                  | Purpose                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dry-run | `bash $SKILL_ROOT/scripts/dry-run-conflicts.sh [LMB?] [FEATURE_BRANCH?]` | The dry-run script handles fetching and conflict detection in one step. The actual rebase happens in the working repo only after the dry-run confirms safety or the user approves a resolution plan. |
| Verify  | `bash $SKILL_ROOT/scripts/verify-no-conflicts.sh`                        | Verify that no conflict markers remain and the rebase is in a good state. Exits 0 if clean, exits 1 with details if conflict markers found or rebase is still in progress.                           |

- `LMB` — remote main branch ref (default: `origin/master` → `origin/main`)
- `FEATURE_BRANCH` — branch to rebase (default: current `HEAD`)

### Conflict Categorization Strategies

| Category                                                           | Strategy                                                                                                                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Machine-generated** (lockfiles, build artifacts, generated code) | Delete and regenerate. Never hand-edit.                                                                                                                                                             |
| **Source code & docs**                                             | Preserve each feature commit's intent by transplanting it onto LMB's refactored structure; read the commit message to determine intent, and only defer to the user when preservation is infeasible. |

## Core Pattern

```mermaid
flowchart TD
    A([Start]) --> B[Dry-run]
    B --> C{Result?}
    C -->|Clean| D[Rebase onto LMB]
    C -->|Conflicts| E[Categorize conflicts]
    E --> F[Present resolution plan]
    F --> F1[Ask user to confirm]
    F1 -->|Confirmed| D
    F1 -->|Rejected| K
    D --> H[Verify]
    H --> I[git push --force-with-lease]
    I --> J[Report result]
    J --> K([Done])
```

## Common Mistakes

| Mistake                       | Why It Fails                                                              | Fix                                                                              |
| ----------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Rebase before dry-run         | Unexpected conflicts waste time and risk data loss                        | Always dry-run first                                                             |
| "Conflicts are small"         | Small conflicts hide semantic issues                                      | Dry-run catches surprises                                                        |
| "I know the conflicts"        | Overconfidence leads to missed edge cases                                 | Trust the process, not memory                                                    |
| Hand-editing lockfiles        | Introduces inconsistent dependency states                                 | Always delete and regenerate                                                     |
| Stale LMB reference           | Rebasing onto outdated main is pointless                                  | Dry-run script fetches automatically                                             |
| Using local main branch       | Local main may be behind remote                                           | Always use `origin/main` or `origin/master`                                      |
| Skipping verification         | Silent merge conflicts or build breaks                                    | Always run verify script                                                         |
| `git rebase --continue` hangs | Opens default editor (e.g. vim) in non-interactive terminal, causing hang | Use `GIT_EDITOR=true git rebase --continue` or `git rebase --continue --no-edit` |
