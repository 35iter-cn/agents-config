---
name: session-topic
description: Manage session artifacts under topic-centric directories
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

### CLI commands

```bash
node $CLAUDE_SKILL_DIR/session-topic.mjs init <semantic-hint>
node $CLAUDE_SKILL_DIR/session-topic.mjs resolve <topic>
node $CLAUDE_SKILL_DIR/session-topic.mjs spec-create <topic> <spec-name>
node $CLAUDE_SKILL_DIR/session-topic.mjs plan-create <topic> <spec-id>
node $CLAUDE_SKILL_DIR/session-topic.mjs spec-status <topic> <spec-id> <status>
node $CLAUDE_SKILL_DIR/session-topic.mjs worktree-path <topic> [dir]
```

### STATE.md

Maintained automatically by the CLI. Spec statuses:

- `open`
- `merged`
- `closed`

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

When a spec is already merged and additional work is needed, do not edit the merged spec. Create a new numbered spec instead:

```bash
node $CLAUDE_SKILL_DIR/session-topic.mjs spec-create <topic> "fix-login-redirect"
```

### Worktrees

For each repository that needs code changes under this topic:

```bash
worktree=$(node $CLAUDE_SKILL_DIR/session-topic.mjs worktree-path <topic>)
git worktree add "$worktree" -b <branch>
```

A topic may span multiple repositories, but each repository has at most one worktree within a topic.

`worktree-path` derives `<repo>` from the git repository at `$PWD` (or the optional `[dir]` argument): it uses the basename of the main worktree directory via `git rev-parse --show-toplevel`, matching the old `session-path` behavior. If the directory is not a git repository, it falls back to the directory basename.

## Common Mistakes

- Creating a new topic when the current context already has one.
- Editing an already-merged spec instead of creating a new numbered spec for follow-up work.
- Forgetting to update `spec-status` after merging or abandoning a spec.
- Writing session artifacts inside the project checkout.

## Red Flags

- A topic name that does not match `YYYY-MM-DD-<semantic>-<adj>-<noun>` is invalid.
- Handoff or UAT files without the correct suffix will not be recognized by convention.
- If `STATE.md` and the actual files disagree, trust the files and update `STATE.md`.
