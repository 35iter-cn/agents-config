---
name: merge-pr
description: >-
  Merge GitHub pull requests via gh CLI using squash and remote branch deletion.
  Use when the user explicitly asks to merge a PR or merge the pull request.
  Do not use for creating PRs, reviews, or push-only workflows.
category: workflow
date_added: "2026-07-28"
---

# Merge PR

Merge one or more GitHub pull requests with `gh`, then clean up linked worktrees.

## When to Use

- User explicitly asks to merge a PR / merge the pull request
- User names PR numbers, URLs, or says to merge the PR(s) discussed in the conversation

## When NOT to Use

- Creating or updating a PR (`pr-handoff`)
- Code review only
- Push-only / CI-only work without an explicit merge request
- Auto-merging after review or handoff without an explicit merge ask

## Locked Defaults

| Decision | Rule |
|----------|------|
| Merge method | Always `gh pr merge <n> --repo <owner/name> --squash --delete-branch --admin` |
| `--admin` | Enabled by default |
| Target PR(s) | Derive from conversation + current checkout; **confirm list with user before merging** |
| Local uncommitted or unpushed | **Hard stop** — do not merge |
| CI failed | Self-fix + push, max **2** rounds; still red → hard stop (no `--admin`) |
| CI pending | Wait until checks finish, then re-check — do not ask |
| Missing approval | Ignore |
| Conflicts / `mergeable=false` | Hard stop (not a CI-fix path) |
| After merge | Remove **linked** worktree only (no `--force`); **never delete local branch**; leave main worktree in place |

## Procedure

### 1. Identify and confirm

Build a candidate list from conversation context (URLs, `#n`, repo names, paired portals) and/or `gh pr view` in the current checkout.

Each item: `{ repo, number, url, headRef }`.

Present the list and **wait for user confirmation** before any merge. Do not auto-merge paired repos without that confirmation.

### 2. Resolve local checkout

For each confirmed PR, locate the local git directory:

- Current cwd if it matches the PR head branch
- `git worktree list` for a worktree on `headRef`
- Common layout: `~/.config/worktrees/<repo>-<branch>/`

Record the path for gates and cleanup.

### 3. Local gate (hard stop)

In that path:

```bash
git status --porcelain
git rev-list --left-right --count @{u}...HEAD
```

- Any uncommitted changes → hard stop with details
- Ahead of upstream (unpushed commits) → hard stop with details
- No upstream set → hard stop; require a pushed tracking branch before merge

Do not merge remote tip while local work is dirty or unpushed.

### 4. Remote gate

```bash
gh pr view <n> --repo <owner/name> --json state,mergeable,mergeStateStatus,statusCheckRollup,url,headRefName
```

Ignore `reviewDecision` / approval state.

| Condition | Action |
|-----------|--------|
| `state=MERGED` (or already closed+merged) | Report and skip |
| Conflict / `mergeable=false` / merge blocked by conflicts | Hard stop |
| Any check conclusion `FAILURE` / `CANCELLED` (treat failed) | Enter CI fix loop (step 5) |
| Any check `IN_PROGRESS` / `QUEUED` / pending | Wait (step 5a), then re-run this gate |
| All checks success, or **no checks reported** | Proceed to merge |
| Soft issues you already handled above | Continue |

### 5a. CI pending

```bash
gh pr checks <n> --repo <owner/name> --watch
```

Do not ask the user. When watch completes, return to step 4.

### 5. CI fix loop (max 2 rounds)

1. Inspect failure: `gh run view <run-id> --repo <owner/name> --log-failed` (or equivalent from `gh pr checks`)
2. Fix the root cause in the local checkout
3. Commit if needed (in-scope because the user already asked to merge), then push
4. Wait for checks (`gh pr checks --watch`), re-evaluate
5. After **2** failed fix+push rounds still red → hard stop; report logs and attempts; do **not** use `--admin`

### 6. Merge

```bash
gh pr merge <n> --repo <owner/name> --squash --delete-branch --admin
```

Never pass `--merge` or `--rebase`. `--admin` is the default for this skill.

If the command fails because squash is disallowed, hard stop and report repo merge settings — do not silently switch methods.

### 7. Worktree cleanup

```bash
git worktree list --porcelain
```

- If the PR checkout path is a **linked** worktree (not the repository's main worktree):  
  `git worktree remove <path>`  
  On failure: report and stop cleanup attempts — **no `--force`**
- If the checkout is the **main** worktree: leave it; report that only the remote branch was deleted
- **Never** `git branch -d` / `-D` the local branch

### 8. Output

For each PR report:

- PR URL
- Squash merge commit OID (from `gh pr view` / merge result)
- Whether a linked worktree was removed

## Anti-patterns

- Merging without an explicit user request to merge
- Merging without confirming the derived PR list
- Using `--merge` or `--rebase`
- Deleting local branches
- `git worktree remove --force`
- Auto-merging paired Owner/Company (or other) PRs without confirmation
- Ignoring local dirty/unpushed state because GitHub looks green
- Treating missing approval as a blocker
- Asking the user to wait on CI instead of `--watch`
- Bypassing conflicts with force merge
