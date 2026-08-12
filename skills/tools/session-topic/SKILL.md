---
name: session-topic
description: Use when creating, reading, or updating session-level artifacts (specs, plans, handoffs, UAT cases, linked worktrees) to keep them out of project checkouts, or before writing code in a topic-mode session so changes land in the topic worktree, never the main checkout
---

## Overview

Manage all session artifacts (specs, plans, handoffs, UAT cases, worktrees) under `~/.config/sessions/<topic>/`. A topic is derived from conversation context and reused within the same session.

Session artifacts must **never** be written inside a project checkout. Use the topic directory for all session-level documents.

## When to Use

Whenever you need to create, read, or update a session artifact. This includes:

- Writing specs or plans
- Creating handoff documents
- Generating UAT cases
- Resolving paths for linked worktrees

## When NOT to Use

- For committed project files (use the project repository)
- For temporary files that do not need to outlive the session

## Quick Reference

Run `node $CLAUDE_SKILL_DIR/session-topic.mjs --help` to list all commands.

### Topic naming

A topic directory name has the form:

```
YYYY-MM-DD-<semantic>-<adjective>-<noun>
```

- `YYYY-MM-DD`: creation date
- `<semantic>`: 1-3 kebab-case words describing the goal, derived from context
- `<adjective>-<noun>`: random suffix to ensure uniqueness, reused from the companions word lists

### Topic lifecycle

1. If the conversation context already has a topic, reuse it.
2. If not, derive a semantic hint from the user's request and run:
   ```bash
   node $CLAUDE_SKILL_DIR/session-topic.mjs init <semantic-hint>
   ```
   This prints the full topic name.
3. Remember the topic in the conversation context for reuse.

### File conventions

Under the topic directory:

| Kind | Pattern |
|---|---|
| Spec | `NN-<name>.spec.md` — placed directly in the topic root, never under `specs/` |
| Plan | `NN-<name>.plan.md` — placed directly in the topic root, never under `plans/` |
| Handoff | `<prefix>.handoff.md` |
| UAT case | `<prefix>.uat-case.md` |
| Worktree | `worktree-<repo>/` |
| State | `STATE.md` |

### Spec-Plan pairing

A plan is always tied to a spec and **must share the same number and name**:

- Spec `01-auth-refactor.spec.md` → Plan `01-auth-refactor.plan.md`
- Spec `02-fix-login-redirect.spec.md` → Plan `02-fix-login-redirect.plan.md`

Use `plan-create <topic> <spec-id>` with the **existing spec id**, not a new number. It initializes the plan status as `open`.

Use `plan-status <topic> <spec-id> implemented` when the plan has been executed.

Do not create a new spec just to hold an implementation plan; the plan belongs to the original spec.

### CLI commands

```bash
node $CLAUDE_SKILL_DIR/session-topic.mjs init <semantic-hint>
node $CLAUDE_SKILL_DIR/session-topic.mjs resolve <topic>
node $CLAUDE_SKILL_DIR/session-topic.mjs spec-create <topic> <spec-name>
node $CLAUDE_SKILL_DIR/session-topic.mjs plan-create <topic> <spec-id>   # creates NN-<name>.plan.md with plan: open
node $CLAUDE_SKILL_DIR/session-topic.mjs plan-status <topic> <spec-id> <open|implemented>
node $CLAUDE_SKILL_DIR/session-topic.mjs worktree-path <topic> [dir]
node $CLAUDE_SKILL_DIR/session-topic.mjs guard <topic> [dir]   # exit 1 unless $PWD is the topic worktree
```

### STATE.md

Maintained automatically by the CLI. Each spec entry may include:

- `id`: the spec number
- `name`: the spec slug
- `plan`: `open` | `implemented` | omitted when no plan exists

## Core Flow

### Creating the first spec

1. Derive a semantic hint from the user's request (e.g., `auth refactor`).
2. Create the topic:
   ```bash
   topic=$(node $CLAUDE_SKILL_DIR/session-topic.mjs init "auth refactor")
   ```
3. Create the first spec:
   ```bash
   node $CLAUDE_SKILL_DIR/session-topic.mjs spec-create "$topic" "auth-refactor"
   ```
4. Write the spec content to the printed path.

### Continuing work on an existing topic

1. Read the current topic from conversation context.
2. Resolve the topic directory:
   ```bash
   node $CLAUDE_SKILL_DIR/session-topic.mjs resolve <topic>
   ```
3. Read `STATE.md` to understand current progress.
4. Create or update files as needed.

### Bug fixes and follow-up work

When a spec is already finalized and additional work is needed, do not edit the spec. Create a new numbered spec instead:

```bash
node $CLAUDE_SKILL_DIR/session-topic.mjs spec-create <topic> "fix-login-redirect"
```

Then create its plan with `plan-create <topic> <new-spec-id>`.

### Worktrees (MANDATORY for code changes)

**Topic-mode code changes happen ONLY inside the topic worktree. The main checkout is never modified for topic work.** This is a hard rule, not a preference.

```bash
worktree=$(node $CLAUDE_SKILL_DIR/session-topic.mjs worktree-path <topic>)
git worktree add "$worktree" -b <branch>
```

Before writing ANY code, run guard to verify you are inside the worktree:

```bash
node $CLAUDE_SKILL_DIR/session-topic.mjs guard <topic>   # exit 1 unless $PWD is the topic worktree
```

`guard` fails (exit 1) when you are in the main checkout or any other location. If it fails, stop, create the worktree, re-run `guard`, then code.

A topic may span multiple repositories, but each repository has at most one worktree within a topic.

## Common Mistakes

- Editing the main checkout during topic work instead of the topic worktree.
  - **Anti-pattern:** implementing a spec in `/home/manooog/code/.../<repo>` because the main checkout already has node_modules/rush installed.
  - **Correct:** `guard` first — if it exits 1, create the topic worktree and work there. Main-checkout state (installed deps, running dev server) is not a reason to modify it.
- Creating a new topic when the current context already has one.
- Editing an already-finalized spec instead of creating a new numbered spec for follow-up work.
- Forgetting to update `plan-status` after a plan has been executed.
- Writing session artifacts inside the project checkout.
  - **Anti-pattern:** Putting helper scripts, seed SQL, or e2e flow files in the worktree.
    ```
    # ❌ Wrong
    worktree-backend/start-payments-e2e.sh
    worktree-backend/prepare-e2e-refund-data.sql
    worktree-backend/run-local-e2e-refund-flow.sh

    # ✅ Correct
    ~/.config/sessions/2026-08-09-app-fee-online-refund-curious-temple/start-payments-e2e.sh
    ~/.config/sessions/2026-08-09-app-fee-online-refund-curious-temple/prepare-e2e-refund-data.sql
    ~/.config/sessions/2026-08-09-app-fee-online-refund-curious-temple/run-local-e2e-refund-flow.sh
    ```
    These files support a specific session, not the repository. Keeping them in the checkout risks accidental commits and loses them when the worktree is removed.
- Creating a plan with a new number instead of reusing the spec's id.
  - **Anti-pattern:** Needing a plan for spec `02-fix-login-redirect` and running `spec-create` to produce `03-fix-login-redirect-plan`.
  - **Correct:** Run `plan-create <topic> 02`, which produces `02-fix-login-redirect.plan.md` and sets `plan: open`. Mark it `implemented` when done.

## Red Flags

- A topic name that does not match `YYYY-MM-DD-<semantic>-<adj>-<noun>` is invalid.
- Handoff or UAT files without the correct suffix will not be recognized by convention.
- If `STATE.md` and the actual files disagree, trust the files and update `STATE.md`.
- Writing topic code anywhere other than the topic worktree.

## Code Location Rationalizations — STOP and Use the Worktree

| Excuse | Reality |
|--------|---------|
| "The main checkout already has node_modules/rush installed; a worktree needs a full reinstall" | Setup cost is not a reason to violate isolation. Create the worktree, re-run guard, then code. |
| "The change is small / additive / low-risk" | Size does not decide location. The rule is unconditional inside topic mode. |
| "I didn't commit, so the main checkout is safe" | Uncommitted edits on a detached or shared main checkout are exactly how work gets lost. "No commit" is not safety. |
| "I'll move it to a worktree after" | The worktree must exist BEFORE the first edit, not after. |

**All of these mean: stop, create the topic worktree, re-run guard, then code.**
