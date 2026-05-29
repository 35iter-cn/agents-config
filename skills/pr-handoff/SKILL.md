---
name: pr-handoff
description: Use when a feature branch is ready for QA handoff -- creating or updating a PR.
category: workflow
date_added: "2026-05-27"
---

# PR Handoff

Auto-detects create vs update from PR state.

## Pre-step

`git status --short` -> stage + commit. Compute `BASE_BRANCH=$(git remote show origin | grep "HEAD branch" | awk '{print $NF}')`. Fetch + rebase. Conflict -> stop, manual resolve.

`gh pr view --json number,state` -> OPEN: Update Flow. Else: Create Flow.

## Create PR Flow

1. **Analyze**: diff against `origin/$BASE_BRANCH..HEAD`. Generate summary.
2. **Pre-push**: Run [Pre-push Checks](#pre-push-checks). Stop on fail.
3. **Push**.
4. **Create PR**: Template order `.github/pull_request_template.md` -> `docs/PR_TEMPLATE.md` -> `.github/PULL_REQUEST_TEMPLATE.md`. Base body, append summary/file changes/where-to-test/edge cases.
5. **UAT**: Frontend (judge from `.tsx`/`.jsx`/`react` deps)? **MUST** run `pr-uat-case-gen`. File non-empty -> post comment with `FEATURE_SLUG=$(git branch --show-current | sed 's/.*\///' | sed 's/[A-Z]/\L&/g; s/_/-/g')` and `<!-- uat-cases:$FEATURE_SLUG -->` marker. Empty -> skip. Missing -> warn. Not frontend -> skip.
6. **Verify**.

## Update PR Flow

1. **Analyze**: full diff + incremental diff since last push.
2. **Pre-push**: Run [Pre-push Checks](#pre-push-checks). Stop on fail.
3. **Push**.
4. **Update body**: Same template + current state. Replace entirely.
5. **UAT** (frontend only, MUST run pr-uat-case-gen): Query existing comment by `<!-- uat-cases:$FEATURE_SLUG -->` marker -> PATCH or create. Empty file + old comment -> delete.
6. **Verify**.

## Pre-push Checks

Probe in order: `rush.json` -> `package.json` -> `go.mod` -> `Cargo.toml` -> `pyproject.toml` -> `Makefile` -> none. Run standard checks per type. `rush.json` -> skip all, recommend `rush build`. Failure stops flow.
