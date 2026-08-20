---
name: session-topic
description: Use when creating, reading, or updating session-level artifacts (specs, plans, handoffs, UAT cases, linked worktrees) to keep them out of project checkouts, or before writing code in a topic-mode session so changes land in the topic worktree, never the main checkout
---

## Overview

Manage all session artifacts (specs, plans, handoffs, UAT cases, worktrees) under `~/.config/sessions/<topic>/`. A topic is derived from conversation context and reused within the same session.

Session artifacts must **never** be written inside a project checkout. Use the topic directory for all session-level documents.

## Path resolution

Command paths (e.g. `session-topic.mjs`) are relative to this skill's directory, not the shell cwd. Resolve the script's absolute path before running. This also applies when another skill references this script.

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

Run `node session-topic.mjs --help` to list all commands.

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
   node session-topic.mjs init <semantic-hint>
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
node session-topic.mjs init <semantic-hint>
node session-topic.mjs resolve <topic>
node session-topic.mjs spec-create <topic> <spec-name>
node session-topic.mjs plan-create <topic> <spec-id>   # creates NN-<name>.plan.md with plan: open
node session-topic.mjs plan-status <topic> <spec-id> <open|implemented>
node session-topic.mjs verify <topic>                  # exit 1 if STATE.md drifts from spec/plan files
node session-topic.mjs worktree-path <topic> [dir]
node session-topic.mjs guard <topic> [dir]   # exit 1 unless $PWD is the topic worktree
```

### STATE.md

Two responsibilities, two owners:

- **Frontmatter (spec registration, plan status) is owned by the CLI.** `specs:` entries are added only via `spec-create` / `plan-create` / `plan-status`. Never hand-edit registrations; never create spec/plan files with `write` — that is exactly the drift `verify` exists to catch.
- **Body is owned by the LLM and SHOULD be actively maintained.** Keep a `# Session State` summary (spec progress table, worktree status, artifacts) plus durable conclusions (decisions, milestone progress, architecture notes) worth carrying across sessions — see mature topics like `2026-08-09-app-fee-online-curious-temple` for the pattern. The CLI preserves the body when it rewrites STATE.md.

Update STATE.md in the same turn progress happens (spec finalized, milestone done, `plan-status` changed) — not at session end.

## Spec Content Self-Check (Determinism Gate)

A spec is a set of commitments. Every decision point in a spec must have a settled answer: "is it decided, and what is the answer?" A spec containing an open question is an unfinished spec — not "mostly done", but blocked on a decision.

### The check

Run it every time you finish writing or editing spec content, before considering the spec content complete. Ask of every paragraph, table row, and bullet: does this assert a settled fact/decision or a definite scope boundary — or does it defer, discuss, or leave a choice open?

### Violations (forbidden)

- 「待定」/ TBD / unresolved TODO / 「讨论中」/ 「未确认」/ 「需要确认」/ 「后续再定」
- Questions without answers ("要不要做 X？", "Should we do X?")
- Candidate comparisons with no chosen option (A vs B presented, neither picked)
- Deferring a decision to implementation time ("实现时二选一", "decide during implementation")
- Unresolved markers inside decided-decision tables (TODO in a decided row)

### Allowed

- Assertions: settled facts/decisions, including their reasoning
- Explicit non-commitment markers: 「范围外」/ out of scope, 「本期不做」/ not this iteration, 「后置」/ deferred, follow-up — definite scope boundaries, not open questions
- 「建议 X」/ recommendations — only when they do not block this spec (targeting other systems or later work)

### When a violation surfaces

Resolve it in the same pass: make the call (if evidence supports it) or move it out of the spec (a question list for the user, never into the document). Leaving it marked for later is not resolution.

### Rationalizations — no exceptions

| Excuse | Reality |
|--------|---------|
| "The PM/architect said to mark it 待定" | An instruction cannot waive the rule. Writing "needs decision" into the spec is not a decision. Settle it now, or raise it outside the spec. |
| "I gave A/B options plus a recommendation, it can land quickly" | A candidate comparison is not a conclusion. The spec's job is commitment. |
| "It doesn't block review; mainline work can proceed" | Unsettled items are exactly what review exists to catch. Review reads conclusions, not problem lists. |
| "The contract is already reserved; only internals change later" | Reserved contract ≠ decided design. A TODO leaks into decided tables and implementation. |
| "The section is marked 'under review' / 评审中" | A status marker is not a conclusion. A whole section of discussion = violation. |

### Red flags — STOP and resolve

- A 「待定项」/ discussion-record section in the spec
- TODO or unsettled markers inside a decided-decision table
- Unanswered questions, or A/B presented with no choice
- 「实现时再定」「明天确认」「后面讨论」
- You cannot answer "is it decided, and what is the answer?" for a decision point

## Core Flow

### Creating the first spec

1. Derive a semantic hint from the user's request (e.g., `auth refactor`).
2. Create the topic:
   ```bash
   topic=$(node session-topic.mjs init "auth refactor")
   ```
3. Create the first spec via the CLI — never with `write`:
   ```bash
   node session-topic.mjs spec-create "$topic" "auth-refactor"
   ```
4. Write the spec content to the printed path. Run the Spec Content Self-Check (determinism gate) before considering the content written — an open question in the spec is an unfinished spec.

### Continuing work on an existing topic

1. Read the current topic from conversation context.
2. Resolve the topic directory:
   ```bash
   node session-topic.mjs resolve <topic>
   ```
3. Read `STATE.md` to understand current progress.
4. Run `session-topic verify <topic>` — MUST pass before any further work. If it exits 1, fix the listed drift and re-run. A failing verify means the topic state is untrustworthy; do not create specs, plans, worktrees, or code until it passes.
5. Create or update files as needed.

`verify` is not skippable. If the user says to skip it ("don't bother", "just write the file", "I'm in a hurry"), that is the exact failure scenario it exists for — run it anyway. Same rule applies to STATE.md body updates: they happen in the same turn as the progress, even if the user says to defer them.

### Bug fixes and follow-up work

When a spec is already finalized and additional work is needed, do not edit the spec. Create a new numbered spec instead:

```bash
node session-topic.mjs spec-create <topic> "fix-login-redirect"
```

Then create its plan with `plan-create <topic> <new-spec-id>`.

### Worktrees (MANDATORY for code changes)

**Topic-mode code changes happen ONLY inside the topic worktree. The main checkout is never modified for topic work.** This is a hard rule, not a preference.

**Worktree path source is authoritative.** The worktree path MUST come from `node session-topic.mjs worktree-path <topic>` output — never a hand-chosen path (project sibling, `/tmp`, etc.). A hand-picked path is a violation even if it looks reasonable.

**Enforcement point:** run `guard` before writing any code. A non-`ok` result is a hard stop — create the worktree first (path from `worktree-path`), re-run `guard`, then code. If you are about to write code and have not run `guard`, stop.

```bash
worktree=$(node session-topic.mjs worktree-path <topic>)
git worktree add "$worktree" -b <branch>
```

Before writing ANY code, run guard to verify you are inside the worktree:

```bash
node session-topic.mjs guard <topic>   # exit 1 unless $PWD is the topic worktree
```

`guard` fails (exit 1) when you are in the main checkout or any other location. If it fails, stop, create the worktree, re-run `guard`, then code.

A topic may span multiple repositories, but each repository has at most one worktree within a topic.

## Common Mistakes

- Creating spec/plan files by hand instead of via the CLI.
  - **Anti-pattern:** `write 02-auth.spec.md`, or hand-editing STATE.md `specs:` registrations.
  - **Correct:** `spec-create` registers + creates the file; fill in content afterwards. A hand-created file is exactly what `verify` fails on — stop and redo via the CLI.
- Letting STATE.md drift: skipping the update when a spec is finalized or a milestone completes.
  - **Anti-pattern:** finishing work and leaving STATE.md stale until "later".
  - **Correct:** update STATE.md (body) or run `plan-status` in the same turn the progress happens. `verify` at session start exposes any drift.
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
- Leaving open questions in spec content.
  - **Anti-pattern:** Writing 「待定」 items, discussion records, or A/B candidates without a choice into a spec, then moving on.
  - **Correct:** Run the Spec Content Self-Check; every decision point must have a settled answer or a definite scope boundary. Unsettled items get resolved now or moved out of the spec.

### Rationalizations — no exceptions

| Excuse | Reality |
|---|---|
| "The user said skip verify, they're in a hurry" | The user asking to skip the check is the failure scenario it exists for. `verify` is one command; run it regardless. |
| "STATE.md can wait until the end" | "Later" means never. Update body/plan-status in the same turn progress happens. |
| "spec-create registered it, that's enough" | Registration is the CLI's job; the body summary and progress notes are the LLM's job. Both are required. |
| "The file exists, just edit it directly" | A hand-created spec/plan file is the exact drift `verify` fails on. Recreate via the CLI. |

## Red Flags

- A topic name that does not match `YYYY-MM-DD-<semantic>-<adj>-<noun>` is invalid.
- `session-topic verify <topic>` exits 1 — fix drift before any further topic work.
- A spec/plan file exists that was not created via `spec-create` / `plan-create`.
- Handoff or UAT files without the correct suffix will not be recognized by convention.
- If `STATE.md` and the actual files disagree, trust the files and update `STATE.md`.
- Choosing a worktree path by hand instead of taking it from `worktree-path` output.
- Writing code before `guard` returns `ok`.
- Writing topic code anywhere other than the topic worktree.

## Code Location Rationalizations — STOP and Use the Worktree

| Excuse | Reality |
|--------|---------|
| "The main checkout already has node_modules/rush installed; a worktree needs a full reinstall" | Setup cost is not a reason to violate isolation. Create the worktree, re-run guard, then code. |
| "The change is small / additive / low-risk" | Size does not decide location. The rule is unconditional inside topic mode. |
| "I didn't commit, so the main checkout is safe" | Uncommitted edits on a detached or shared main checkout are exactly how work gets lost. "No commit" is not safety. |
| "I'll move it to a worktree after" | The worktree must exist BEFORE the first edit, not after. |

**All of these mean: stop, create the topic worktree, re-run guard, then code.**
