---
name: magicdoor-pr-uat-cases
description: |
  Use when a feature branch needs UAT test cases derived from its actual diff
  scope, before QA handoff or PR review. Triggered by requests to "write UAT
  cases", "generate test cases from diff", or when preparing regression
  documentation for a frontend PR.
category: workflow
date_added: "2026-05-27"
---

# MagicDoor PR UAT Case Generator

## Overview

Generate must-test UAT cases from the actual diff of a feature branch against
its true base branch. Up to 10 cases, scaled to diff size. The skill enforces
verification of the base branch, diff scope, and modified content before
writing any cases.

## When to Use

- User asks to "write UAT cases" or "generate test cases" for a PR/branch
- Preparing QA handoff documentation for a frontend feature branch
- Need to confirm what a PR actually changes before defining test scope

**Do NOT use when:**
- The branch has not been pushed or has no commits
- The request is for unit/integration tests (this skill is for UAT/manual tests)
- The diff is a one-line fix (UAT cases are overkill)

## Core Flow

Run these steps in order. Do not skip or reorder.

### Step 1: Identify the Base Branch

Determine the correct base branch. Check in this order:

1. `git remote show origin | grep "HEAD branch"` — this is the canonical default
2. Fall back to checking `origin/master`, `origin/main`, `master`, `main`
3. If ambiguous, ask the user explicitly

**Record the base branch as `BASE_BRANCH` (e.g., `origin/master`).**

### Step 2: Fetch Latest Base

```bash
git fetch origin $(basename $BASE_BRANCH)
```

Always fetch the latest state of the base branch before computing merge base.
**Never use a stale local tracking branch.**

### Step 3: Verify Branch Fork Point

```bash
MERGE_BASE=$(git merge-base HEAD $BASE_BRANCH)
```

Then verify the current branch actually forks from this base:

```bash
git log --oneline --graph --decorate -10 HEAD
```

**If the current branch does not appear to fork from `BASE_BRANCH`:**
- Print: "Current branch does not appear to be based on `$BASE_BRANCH`."
- Print the merge-base commit hash and its branches: `git branch -r --contains $MERGE_BASE`
- Ask the user to confirm the correct base branch
- **Exit the flow. Do not proceed with diff or UAT cases.**

### Step 4: Diff and Confirm Scope

```bash
git diff --stat $MERGE_BASE..HEAD
```

Read the output and **verbally confirm** the scope with the user before
proceeding. State:

- Number of files changed
- The top-level directories/modules affected
- Whether the changes are frontend-only, backend-only, or cross-stack

**If the diff includes unrelated changes** (e.g., files from another feature or
already-merged PRs), warn the user and ask if they want to proceed with the
full diff or a subset.

### Step 5: Read Modified Files to Understand Changes

For each significant module in the diff, read key files to understand:

- What behavior changed (not just what code changed)
- What the user-facing impact is
- What edge cases or error paths were added

Prioritize reading:
- Design/spec documents (`.knowledge/docs/specs/`, `.knowledge/docs/regression/`)
- Component files with business logic
- Repository/context layers with API calls

### Step 6: Write UAT Cases

Generate **up to 10** UAT cases, fewer if the diff is small (1-3 files = 2-3
cases). Each case must be tied to an actual code change in the diff, not
hypothetical scenarios.

**Case structure:**

```markdown
## Case N: [Short descriptive title]

**Priority**: P0/P1/P2 | **Module**: [Area]

**Test Steps**:
1. ...
2. ...

**Expected Results**:
- ...
- ...

**Risk Point**: [Why this case matters — what could break]

**Related Code**: `file.ts`, `file.tsx`
```

**Prioritization rules:**
- P0: Core user flow changed by this PR, or high regression risk
- P1: Secondary flow or edge case
- P2: Nice-to-have verification

**Output location:** Write to a temporary file in the repo root or
`.knowledge/notes/plans/` with naming convention:
`YYYY-MM-DD-must-test-uat-cases.md`

## Common Mistakes

| Excuse | Reality |
|--------|---------|
| "I'll just diff against local master" | Local master is often stale. Always fetch `origin/master` first. |
| "The merge base is obviously master" | The base branch might be `main`, a release branch, or a feature branch. Verify. |
| "I can tell the PR scope from the branch name" | Branch names are unreliable. The diff is the source of truth. |
| "I'll write cases first, then check the diff" | Cases written before understanding the diff will be wrong or miss critical paths. |
| "This diff includes files from another PR, I'll just include them" | Including unrelated changes inflates the UAT scope and wastes QA time. Confirm with user. |
| "10 cases is the goal" | Fewer, focused cases are better than 10 weak ones. Scale to diff size. |

## Red Flags — STOP and Verify

- Using `git merge-base HEAD master` without first running `git fetch origin master`
- Proceeding with UAT cases when the merge base looks wrong (e.g., includes commits the user doesn't recognize)
- Writing cases for files that don't appear in `git diff --stat $MERGE_BASE..HEAD`
- Cases that describe generic app behavior not changed by this PR
- No P0 cases identified for a medium-to-large diff

## Example Output

```markdown
# Must-Test UAT Cases for [Branch Name]

> Based on merge-base `COMMIT_HASH` against `origin/master`
> Diff: N files changed in [modules]

---

## Case 1: [Core flow — highest risk]

**Priority**: P0 | **Module**: [Area]

**Test Steps**:
1. ...
2. ...

**Expected Results**:
- ...

**Risk Point**: [Specific risk]

**Related Code**: `src/.../File.tsx`

---

## Quick Verification Checklist

```
□ Case 1: ...
□ Case 2: ...
```
```

## Cross-References

- **magicdoor-pr-regression-handoff**: For creating/updating PRs with regression docs
- **magicdoor-knowledge-docs-structure**: For `.knowledge/` documentation conventions
