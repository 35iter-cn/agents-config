---
name: keep-branch-fresh
description: Use when rebasing, syncing branch, or updating to latest main. Rebase a feature branch onto the latest main branch with safety guarantees.
category: workflow
date_added: "2026-05-27"
---

## Overview

Rebase feature branch onto latest main (LMB) safely: dry-run → resolve conflicts → rebase → verify → push.

**LMB** — remote tracking branch after fetch (e.g. `origin/main`). Always fetch first.

**FEATURE_BRANCH** — branch to rebase (default: `HEAD`)

**$dry_run_script_path** — current skill dir + `scripts/dry-run-conflicts.mjs`
**$verify_script_path** — current skill dir + `scripts/verify-no-conflicts.mjs`
**$push_script_path** — current skill dir + `scripts/push-branch.mjs`
**$detect_lmb_script_path** — current skill dir + `scripts/detect-lmb.mjs`

## Steps

### 0. 确定 LMB

`node "$detect_lmb_script_path"`

Prints `<remote>/<branch>` (e.g. `origin/main`). Exit 0 on success, 1 on failure. Pass the output as LMB to Step 1.

### 1. Dry-run

`node "$dry_run_script_path" "$LMB" [FEATURE_BRANCH]`

Fetches LMB and detects conflicts. LMB comes from Step 0.

- Clean → proceed to rebase.
- Conflicts → categorize and resolve (below), get user confirmation, then rebase.

### 2. Resolve conflicts

| Category | Strategy |
|----------|----------|
| Machine-generated (lockfiles, build artifacts) | Delete and regenerate. Never hand-edit. |
| Source code & docs | Transplant each commit's intent onto LMB's structure. Read commit message for intent. Defer to user only when preservation is infeasible. |

### 3. Rebase

Execute rebase onto LMB. Continue with `GIT_EDITOR=true git rebase --continue` (prevents editor hang in non-interactive terminal).

### 4. Verify

`node "$verify_script_path"`

Exits 0 if clean; exits 1 if conflict markers remain or rebase is still in progress.

### 5. Push

`node "$push_script_path"`

Pushes with `--set-upstream --force-with-lease`:
- Remote branch absent → creates and sets upstream
- Remote branch exists → checks remote hasn't changed since last fetch; rejects (exit 2) if it has

**Exit codes:** 1 = general error (retry or abort); 2 = remote has new commits → return to dry-run.

## Anti-patterns

- Rebasing before dry-run.
- Assuming conflicts are "small" — small conflicts hide semantic issues.
- Hand-editing lockfiles — always delete and regenerate.
- Using stale LMB — dry-run script fetches automatically, but verify you're not using a stale local branch name.
- Skipping verification after rebase.
- Force-pushing without verifying.
- Push exit 2 → retrying push instead of returning to dry-run (wastes CI resources).
