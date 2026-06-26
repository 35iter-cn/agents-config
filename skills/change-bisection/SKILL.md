---
description: Use when a feature branch introduces a hard-to-diagnose bug and you need to isolate which change layer or commit is responsible. Create a debug branch from a known-good base, apply changes by functional layers, verify each layer with the user, and zoom into the failing layer.
---

# Change Bisection

## Overview

A structured technique for isolating root cause of a bug on a feature branch. Create a **debug branch from known-good base**, then progressively apply changes by **functional layers** — after each layer, user verifies. When a layer fails, zoom into it with `git bisect` or manual dissection.

**Core principle:** Change one variable at a time. If the bug appears, you know which layer caused it.

## When to Use

**Use when:** bug is hard to reproduce via automated test, the feature branch has changes across multiple functional areas, and manual verification (browser, visual) is needed.

**Do NOT use when:** error message directly points to a file — fix that first; or commits are clean and atomic — `git bisect` alone is faster.

## Core Flow

You MUST create a task for each step and complete them in order.

### Step 1: Create debug branch

```bash
git checkout -b debug/<symptom> <base-ref>
```

The branch name describes the **symptom** (`client-white-screen`), not your guess.

### Step 2: Categorize feature changes into layers

```bash
git diff <base-ref>..<feature-branch> --stat
```

Group changed files by **functional layer** (one independent concern per layer). If you can't describe a layer in 3 words, it's too broad.

**Example:** API handlers → Middleware → Component refactoring → Session lib

*Must be granular enough that each layer can be independently verified.*

### Step 3: Apply & verify — one layer at a time

For each layer, in order:

**3a. Apply the layer:**
```bash
git checkout <feature-branch> -- path/to/files...
git commit -m "layer N: <description>"
```

**3b. Report to user.** Always include:
- What files changed
- How to verify (which page to open, what to click, what should happen)

**3c. Wait for user feedback:**
- ✅ → proceed to next layer
- ❌ → go to Step 4

### Step 4: Zoom into failing layer

**If the layer spans multiple commits — use `git bisect` on that range only:**
```bash
git bisect start
git bisect good <last-commit-before-layer>
git bisect bad <layer's-last-commit>
```
At each stop: apply changes, test with user, mark `git bisect good/bad`. Repeat until a single commit is identified.

**If the layer is a single file or a few lines — binary-search within the code:**
Apply half the changes, test. Repeat until the exact code boundary is found.

### Step 5: Fix & confirm

1. Understand why the specific change causes the bug
2. Apply fix to the feature branch
3. User confirms both: bug is gone AND original feature still works
4. Commit

## Common Mistakes

- Applying multiple layers at once — you lose the ability to pinpoint.
- Not telling the user what or how to verify — always include files changed + test steps.
- Using `git bisect` on the whole branch first — narrow to a failing layer first, bisect is much more expensive when you have 100+ commits and each needs manual verification.
- Skipping the base branch pre-check — confirm base is clean before starting.

## Red Flags

- "Let me apply layers 3 and 4 together to save time" — you're breaking single-variable rule.
- "The bug is obvious, let me just look at the code" — if it were obvious, you'd already have fixed it.
- Adding debug code to the feature branch instead of isolating on a debug branch.
