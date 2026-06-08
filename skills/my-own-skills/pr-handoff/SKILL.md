---
name: pr-handoff
description: Use when a feature branch is ready for QA handoff, a PR needs creating or updating, or pre-push checks must run before opening a PR.
category: workflow
date_added: "2026-05-27"
---

## Overview

Keep branch fresh, run pre-push checks, analyze diff, then create or update PR with complete body and UAT cases.

## When to Use

- Feature branch complete, ready for QA review
- Existing PR needs body update with new changes
- Pre-push checks should run before submitting

## When NOT to Use

- Draft PR still in progress
- Changes not ready for review
- Non-feature branches (chore/refactor)

## Quick Reference

**LMB** (Latest Main Branch) — remote tracking branch ref, e.g. `origin/main`. This is the remote's default branch after fetch. **Always fetch before computing.**

### keep-branch-fresh

**REQUIRED SUB-SKILL:** `keep-branch-fresh`. Always runs first to ensure branch is rebased onto latest main. Stops flow if conflicts unresolvable.

### Pre-push

Probe build system in order: `package.json` → `go.mod` → `Cargo.toml` → `pyproject.toml` → `Makefile` → none. Run standard checks per type.

Failure stops the entire flow.

### Create or update PR

One step that handles PR state check to body creation:

1. **Check PR** — `gh pr view`. No PR / CLOSED → create; OPEN → update.
2. **Analyze** — `git diff origin/$LMB..HEAD`. Single full diff, same for create and update. Used to generate summary and file list.
3. **Body** — Always generate a complete PR body. Probe template: `.github/pull_request_template.md` → `docs/PR_TEMPLATE.md` → `.github/PULL_REQUEST_TEMPLATE.md`. Append: summary + file changes + where-to-test + edge cases.
4. **Push** — `gh pr create` (new) or `gh pr edit --body` (replace entirely).

### Insert UAT comment

**Goal: publish UAT cases to the PR as a comment.**

1. **Generate** — **REQUIRED SUB-SKILL:** `pr-uat-case-gen`. Writes `.knowledge/notes/uat-cases.md`.
2. **Post/Patch** — Read the generated file. If non-empty, search PR comments for `<!-- uat-cases -->`; POST if new, PATCH if exists. If empty/missing, skip.

**Must publish.** Do not stop at file generation; `pr-uat-case-gen` alone only writes the file, this step must also publish it.

### Verify

`gh pr view` to confirm PR is created/updated and visible.

## Core Flow

```mermaid
flowchart TD
    A([Start]) --> B[keep-branch-fresh]
    B --> C[Pre-push]
    C --> D[Create or update PR]
    D --> E[Insert UAT comment]
    E --> F[Verify]
    F --> G([Done])
```

## Common Mistakes

- Skipping keep-branch-fresh when branch is stale → body references outdated code, merge conflicts in review.
- Creating PR before pushing → empty body, broken links (keep-branch-fresh already handles push).
- Skipping pre-push checks under time pressure.
- Not fetching remote before computing LMB (stale local).
- Using wrong LMB when origin HEAD differs from local main.
- Stopping at file generation after `pr-uat-case-gen` without publishing the UAT comment to the PR.
- Creating duplicate UAT comments on the same PR instead of patching the existing one.

## Red Flags

- Skipping keep-branch-fresh to "save time".
- `git push` before pre-push checks.
- Force-push without checking PR state.
- Rebasing without fetching origin HEAD first.
- Skipping UAT with "backend-only" excuse on repos with `.tsx`/`.jsx`.
