---
name: pr-uat-case-gen
description: Use when a feature branch needs UAT test cases before QA handoff or PR review.
category: workflow
date_added: "2026-05-27"
---

# PR UAT Case Generator

Called by `pr-handoff` or standalone. Output: `.knowledge/notes/uat-cases.md`.

## Core Flow

1. **Detect base**: `git remote show origin | grep "HEAD branch" | awk '{print $NF}'` -> `$BASE_BRANCH`. Fetch. Never use stale local.
2. **Verify fork**: `MERGE_BASE=$(git merge-base HEAD $BASE_BRANCH)`. Bad fork -> print merge-base + `git branch -r --contains $MERGE_BASE`, ask user, stop.
3. **Diff**: `git diff --stat $MERGE_BASE..HEAD`. Confirm scope.
4. **Read**: understand behavior change, impact, edge cases.
5. **Write**: up to 10 cases, fewer for small diffs. Each tied to actual code change.

**Format (no h1, no metadata):**
```
## Case N: [title]
**Priority**: P0/P1/P2 | **Module**: [Area]
**Test Steps** / **Expected Results** / **Risk Point** / **Related Code**
```
P0 = core flow. P1 = secondary. P2 = nice-to-have.

## Common Mistakes

Local master is stale. Base might be `main`/release. Branch names unreliable. Fewer focused cases > 10 weak ones. Unrelated files inflate scope.

## Red Flags

Merge-base without fetch. Cases not from diff. No P0 for medium diff.
