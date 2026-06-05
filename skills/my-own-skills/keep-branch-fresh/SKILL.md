---
name: keep-branch-fresh
description: Use when rebasing, syncing branch, or updating to latest main. Rebase a feature branch onto the latest main branch with safety guarantees.
category: workflow
date_added: "2026-05-27"
---

## Overview

Safely rebase a feature branch onto the latest main branch (LMB).

## Quick Reference

**LMB** (Latest Main Branch) — remote HEAD branch ref. Detect: `git remote show origin | grep "HEAD branch" | awk '{print $NF}'`. **Always fetch before computing.**

**FEATURE_BRANCH** — branch to rebase (default: current `HEAD`)

### Dry-run

`skill://keep-branch-fresh/scripts/dry-run-conflicts.mjs [LMB] [FEATURE_BRANCH]`

Fetches latest LMB and detects conflicts in one step. The actual rebase only proceeds after dry-run confirms safety or the user approves a resolution plan.

- Clean → proceed to rebase.
- Conflicts found → categorize and present resolution plan (see [Resolve conflicts](#resolve-conflicts)).

### Resolve conflicts

Only needed when dry-run detects conflicts.

| Category                                                           | Strategy                                                                                                                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Machine-generated** (lockfiles, build artifacts, generated code) | Delete and regenerate. Never hand-edit.                                                                                                                                                  |
| **Source code & docs**                                             | Preserve each feature commit's intent by transplanting onto LMB's refactored structure. Read the commit message to determine intent. Defer to user only when preservation is infeasible. |

Present plan to user, get confirmation, then proceed to rebase.

### Rebase

Execute the rebase onto LMB. Each commit's intent is preserved.

If `git rebase --continue` opens an editor and hangs in non-interactive terminal: `GIT_EDITOR=true git rebase --continue` or `git rebase --continue --no-edit`.

### Verify

`skill://keep-branch-fresh/scripts/verify-no-conflicts.mjs`

检查 rebase 是否干净完成。Exits 0 if clean, exits 1 with details if conflict markers remain or rebase is still in progress.

### Push

`skill://keep-branch-fresh/scripts/push-branch.mjs`

将当前分支安全推送到远程。脚本自动检测 upstream 状态并选择推送策略：

- **已有 upstream**：使用安全的 force-push 方式（如 `--force-with-lease`）
- **首次推送**：建立 upstream 追踪关系后推送

**失败处理：**
- exit 1：通用错误（网络、权限等），阅读错误输出后重试或中止
- exit 2：远程分支已有新提交，需要回到 Dry-run 阶段重新评估

## Common Mistakes

- Rebasing before dry-run — unexpected conflicts waste time and risk data loss.
- Assuming "conflicts are small" — small conflicts hide semantic issues.
- Overconfidence about known conflicts — trust the process, not memory.
- Hand-editing lockfiles — introduces inconsistent dependency states. Always delete and regenerate.
- Using stale LMB reference — rebasing onto outdated main is pointless. Dry-run script fetches automatically.
- Using local branch name instead of LMB — local branch may be behind remote. Use `git remote show origin | grep "HEAD branch"` to detect LMB.
- Skipping verification — silent merge conflicts or build breaks.
- `git rebase --continue` hangs in non-interactive terminal — use `GIT_EDITOR=true git rebase --continue`.
- Push 脚本返回 exit 2 时未回到 dry-run，而是直接重试 push → 会反复失败，浪费 CI 资源。

## Red Flags

- Rebasing before dry-run.
- Force-pushing without verifying.
- Hand-editing lockfiles.
- Skipping verification after rebase.
