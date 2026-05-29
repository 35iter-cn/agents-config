---
name: pr-handoff
description: Use when a feature branch is ready for QA handoff, a PR needs creating or updating, or pre-push checks must run before opening a PR.
category: workflow
date_added: "2026-05-27"
---

# PR Handoff

Auto-detects create vs update from PR state.

## When to Use

- Feature branch complete, ready for QA review
- Existing PR needs body update with new changes
- Pre-push checks should run before submitting

**When NOT to use:** Draft PR still in progress, changes not ready for review, or non-feature branches (chore/refactor).

## Quick Reference

| `gh pr view` state | Flow           |
| ------------------ | -------------- |
| No PR / CLOSED     | Create PR Flow |
| OPEN               | Update PR Flow |

## Pre-step

`git status --short` → stage + commit. Compute `BASE_BRANCH=$(git remote show origin | grep "HEAD branch" | awk '{print $NF}')`. Fetch + rebase. Conflict → stop, manual resolve.

`gh pr view --json number,state` → OPEN: Update Flow. Else: Create Flow.

## Pre-push Checks

Probe in order: `rush.json` → `package.json` → `go.mod` → `Cargo.toml` → `pyproject.toml` → `Makefile` → none. Run standard checks per type. `rush.json` → skip all, recommend `rush build`. Failure stops flow.

## Create PR Flow

1. **Analyze**: diff against `origin/$BASE_BRANCH..HEAD`. Generate summary.
2. **Pre-push**: Run [Pre-push Checks](#pre-push-checks). Stop on fail.
3. **Push**.
4. **Create PR**: Template order `.github/pull_request_template.md` → `docs/PR_TEMPLATE.md` → `.github/PULL_REQUEST_TEMPLATE.md`. Base body, append summary/file changes/where-to-test/edge cases.
5. **UAT** (frontend only): **REQUIRED SUB-SKILL:** `pr-uat-case-gen`. File non-empty → post comment with `FEATURE_SLUG=$(git branch --show-current | sed 's/.*\///' | sed 's/[A-Z]/\L&/g; s/_/-/g')` and `<!-- uat-cases:$FEATURE_SLUG -->` marker. Empty → skip. Missing → warn.
6. **Verify**.

## Update PR Flow

1. **Analyze**: full diff + incremental diff since last push.
2. **Pre-push**: Run [Pre-push Checks](#pre-push-checks). Stop on fail.
3. **Push**.
4. **Update body**: Same template + current state. Replace entirely.
5. **UAT** (frontend only, **REQUIRED SUB-SKILL:** `pr-uat-case-gen`): Query existing comment by `<!-- uat-cases:$FEATURE_SLUG -->` marker → PATCH or create. Empty file + old comment → delete.
6. **Verify**.

## Common Mistakes

- Creating PR before pushing (PR body is empty, broken links)
- Skipping pre-push checks under time pressure
- Not fetching remote before computing BASE_BRANCH (stale local data)
- Running UAT flow without `pr-uat-case-gen` skill loaded (silent skip)
- Not checking if target repo has a PR template (bare form)
- Using wrong BASE_BRANCH when origin HEAD differs from local main

## Red Flags

- `git push` before running pre-push checks
- Skipping UAT step because "it's a backend-only change" (check for `.tsx`/`.jsx`)
- Partial commit with `--no-verify` flag
- Force-push without checking if PR exists
- Rebasing without fetching origin HEAD first
