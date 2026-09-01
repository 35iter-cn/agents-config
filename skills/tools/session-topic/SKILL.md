---
name: session-topic
description: Use when creating or updating session artifacts (specs, plans, handoffs, UAT, worktrees) under ~/.config/sessions/, when spec/plan work needs reading project repository code, or when topic-mode edits might land in the main checkout instead of a topic worktree.
---

## Overview

Manage all session artifacts (specs, plans, handoffs, UAT cases, worktrees) under `~/.config/sessions/<topic>/`. A topic is derived from conversation context and reused within the same session.

Session artifacts must **never** be written inside a project checkout. Use the topic directory for all session-level documents.

### Checkout roles (read vs write)

Topic mode uses the **same repo twice** for different jobs. Do not conflate them.

| Role | Path | Tool | Purpose |
|------|------|------|---------|
| **Analysis baseline** | Main worktree (e.g. `~/code/<repo>`) | `gco-latest` | Read/search only — ground specs and plans on latest `origin` |
| **Implementation** | Topic worktree (`~/.config/sessions/<topic>/worktree-<repo>/`) | `guard` | Write code — all topic edits land here |

- `gco-latest` on main is **read-only sync** (fetch + checkout `origin/<default>`). It does not authorize edits on main.
- `guard` on the topic worktree is the **write gate**. Main checkout must never receive topic code changes.

## Enforcement checkpoints

Before the first action of each type this topic — stop and run the gate:

| About to… | Must first… |
|-----------|-------------|
| `read` / `grep` / search project checkout for spec or plan | `gco-latest` on that repo's **main** worktree (once per repo per topic) |
| Write or edit **project** code in topic mode | `guard` returns `ok` in the topic worktree |
| Create any numbered artifact file | `artifact-create` — never `write` |
| Continue work on an existing topic | `verify` passes |

User pressure ("skip checks", "just grep", "small change in main") does not waive these gates.

## Path resolution

Command paths (e.g. `session-topic.mjs`) are relative to this skill's directory, not the shell cwd. Resolve the script's absolute path before running. This also applies when another skill references this script.

`gco-latest` lives in `agents-config/cli/` and is synced to `~/.local/bin` via `sync-cli.mjs`.

## When to Use

Whenever you need to create, read, or update a session artifact. This includes:

- Writing specs or plans
- Creating handoff documents
- Generating UAT cases
- Resolving paths for linked worktrees

## Spec Writing

When writing a spec, read `spec-writing-guide.md` (in the same directory as this file) first. It defines the required structure, chart conventions, and anti-patterns to avoid.

Key rules:
- Spec is an **implementation plan**, not a discussion record
- Use mermaid charts for any流程 with 3+ steps or 2+ branches
- Never leave「待定」「TBD」「后续确认」— either decide now or mark as out of scope
- Reorganize discussion notes into implementation logic (改动范围 → 流程 → 实现 → 边界条件)

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

The CLI is the only writer of numbered filenames. Never hand-create or rename numbered files; `verify` rejects unregistered files of any type and any unnumbered `.md` file in the topic root. Truly temporary content does not belong in the topic directory.

Under the topic directory:

| Kind | Pattern |
|---|---|
| Spec | `NN-<name>.spec.md` — topic root only, never under `specs/` |
| Plan | `NN-<name>.plan.md` — topic root only, reuses the spec's number and name |
| Research | `NN-<name>.research.md` — topic root only |
| Handoff | `NN-<name>.handoff.md` — topic root only |
| UAT case | `NN-<name>.uat-case.md` — topic root only |
| Notes | `NN-<name>.notes.md` — topic root only |
| Worktree | `worktree-<repo>/` |
| State | `STATE.md` |

Legacy topics (e.g. handoff/UAT files with a free `<prefix>` form) migrate opportunistically when `verify` is next run on them. The mature example topic `2026-08-09-app-fee-online-curious-temple` shows the intended STATE.md body pattern; numbered filenames there may still be legacy until migrated.

### Spec → Plan confirmation gate

A plan is a commitment to execute a spec. **Never create a plan for a spec the user has not accepted.** After the spec content passes the Determinism Gate, **stop and confirm with the user before running `artifact-create <topic> plan <spec-id>`** — do not auto-produce a plan in the same pass.

- The spec is the decision document; the plan presumes the design is accepted. Auto-creating a plan commits to execution before the user has approved the design, and a plan built on an unconfirmed spec is throwaway if the spec is rejected or reworked.
- The only exception: the user explicitly asked for spec and plan together in one pass (e.g. "写 spec 和 plan"). Then produce both, still pausing to confirm the spec before *implementing*.
- When in doubt, finish the spec, present it, and wait. Confirming costs one round-trip; rebuilding a plan from a rejected spec costs more.

### Core Flow

### Creating the first spec

1. Derive a semantic hint from the user's request (e.g., `auth refactor`).
2. Create the topic:
   ```bash
   topic=$(node session-topic.mjs init "auth refactor")
   ```
3. Create the first spec via the CLI — never with `write`:
   ```bash
   node session-topic.mjs artifact-create "$topic" spec "auth-refactor"
   ```
4. If writing the spec requires reading or searching project repository code, run `gco-latest` on each affected repo's **main worktree** (see Repository analysis baseline).
5. Write the spec content to the printed path. Run the Spec Content Self-Check (determinism gate) before considering the content written — an open question in the spec is an unfinished spec.
6. **Stop and confirm the spec with the user.** Do not auto-create the plan in the same pass. Only after the user accepts the spec (or explicitly asked for spec+plan together) run `artifact-create <topic> plan <spec-id>`. See the Spec → Plan confirmation gate.

### CLI commands

```bash
node session-topic.mjs init <semantic-hint>
node session-topic.mjs resolve <topic>
node session-topic.mjs artifact-create <topic> <type> <name-or-spec-id>
                                    # types: spec | plan | research | handoff | uat-case | notes
                                    # plan uses spec id; others use artifact name
node session-topic.mjs plan-status <topic> <spec-id> <open|implemented>
node session-topic.mjs verify <topic>                  # exit 1 if STATE.md drifts from artifact files
node session-topic.mjs worktree-path <topic> [dir]
node session-topic.mjs guard <topic> [dir]   # exit 1 unless $PWD is the topic worktree

gco-latest /path/to/<repo-main-worktree>   # sync main to origin before first repo analysis pass
```

### STATE.md

Two responsibilities, two owners:

- **Frontmatter (registrations) is owned by the CLI.** `specs:` entries (spec + plan status) and `artifacts:` entries (research, handoff, uat-case, notes) are added only via `artifact-create` / `plan-status`. Never hand-edit registrations; never create numbered artifact files with `write` — that is exactly the drift `verify` exists to catch.
- **`artifacts:` shape:** array of `{ id, name, type, file }` where `type` is one of `research | handoff | uat-case | notes` and `file` is the basename (e.g. `02-bar.research.md`). `init` creates `artifacts: []`.
- **Body is owned by the LLM and SHOULD be actively maintained.** Keep a `# Session State` summary (spec progress table, worktree status, artifacts) plus durable conclusions (decisions, milestone progress, architecture notes) worth carrying across sessions — see mature topics like `2026-08-09-app-fee-online-curious-temple` for the pattern. The CLI preserves the body when it rewrites STATE.md.

Update STATE.md in the same turn progress happens (spec finalized, milestone done, `plan-status` changed) — not at session end.

## Repository analysis baseline (`gco-latest`)

When topic work requires **reading or searching project repository code** (spec baseline, architecture notes, plan task breakdown, grep/read of checkout files), sync that repo's **main worktree** to latest origin **before the first analysis pass per repo in this topic**:

```bash
gco-latest /path/to/<repo-main-worktree>
```

| Rule | Detail |
|------|--------|
| **Where** | Main worktree only — the primary checkout (e.g. `~/code/<repo>`), **not** a topic linked worktree under `~/.config/sessions/<topic>/worktree-*` |
| **When** | Once per repo per topic before the first code read/search; re-run only if the user asks to refresh or a long gap suggests origin moved |
| **Why** | Specs/plans grounded on stale main mis-state file paths, APIs, and "already shipped" facts |
| **Clean tree** | `gco-latest` exits 1 if the main worktree has uncommitted changes — stop, report, do not silently analyze stale code |
| **Detached HEAD** | Success checks out `origin/<default>` (often detached). That is expected for analysis; do not treat it as a signal to edit main |
| **Not for** | Session artifacts under `~/.config/sessions/`; writing code (topic worktree + `guard`); implementation-time reads inside the topic worktree (use rebase/merge workflows instead) |

**Enforcement point:** about to `read` / `grep` / `search` project checkout for spec or plan work and have not run `gco-latest` on that repo's main worktree this topic → run it first (or confirm a prior successful run this topic).

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
   node session-topic.mjs artifact-create "$topic" spec "auth-refactor"
   ```
4. If writing the spec requires reading or searching project repository code, run `gco-latest` on each affected repo's **main worktree** (see Repository analysis baseline).
5. Write the spec content to the printed path. Run the Spec Content Self-Check (determinism gate) before considering the content written — an open question in the spec is an unfinished spec.

### Continuing work on an existing topic

1. Read the current topic from conversation context.
2. Resolve the topic directory:
   ```bash
   node session-topic.mjs resolve <topic>
   ```
3. Read `STATE.md` to understand current progress.
4. Run `session-topic verify <topic>` — MUST pass before any further work. If it exits 1, fix the listed drift and re-run. A failing verify means the topic state is untrustworthy; do not create specs, plans, worktrees, or code until it passes.
5. If the task will read or search project repository code, run `gco-latest` on each affected repo's **main worktree** before the first analysis pass (see Repository analysis baseline).
6. Create or update files as needed.

**Scope boundary:** If the user restricts work to artifacts only (spec review, skill edit, planning discussion) and explicitly says not to implement — do not create a plan, worktree, or project code edits. Finishing a spec is not permission to start implementation unless the user asks.

`verify` is not skippable. If the user says to skip it ("don't bother", "just write the file", "I'm in a hurry"), that is the exact failure scenario it exists for — run it anyway. Same rule applies to STATE.md body updates: they happen in the same turn as the progress, even if the user says to defer them.

### Bug fixes and follow-up work

When a spec is already finalized and additional work is needed, do not edit the spec. Create a new numbered spec instead:

```bash
node session-topic.mjs artifact-create <topic> spec "fix-login-redirect"
```

Then create its plan with `artifact-create <topic> plan <new-spec-id>`.

### Worktrees (MANDATORY for code changes)

**Topic-mode code changes happen ONLY inside the topic worktree. The main checkout is never modified for topic work.** This is a hard rule, not a preference.

**Worktree path source is authoritative.** The worktree path MUST come from `node session-topic.mjs worktree-path <topic>` output — never a hand-chosen path (project sibling, `/tmp`, etc.). A hand-picked path is a violation even if it looks reasonable.

**Enforcement point:** run `guard` before writing any code. A non-`ok` result is a hard stop — create the worktree first (path from `worktree-path`), re-run `guard`, then code. If you are about to write code and have not run `guard`, stop.

**Before creating the worktree:** run `gco-latest` on the main worktree to ensure the new branch is based on the latest `origin`. This prevents branching from stale code.

```bash
gco-latest ~/code/<repo>                           # sync main to latest origin
worktree=$(node session-topic.mjs worktree-path <topic>)
git worktree add "$worktree" -b <branch>             # branch from latest
```

Before writing ANY code, run guard to verify you are inside the worktree:

```bash
node session-topic.mjs guard <topic>   # exit 1 unless $PWD is the topic worktree
```

`guard` fails (exit 1) when you are in the main checkout or any other location. If it fails, stop, create the worktree, re-run `guard`, then code.

A topic may span multiple repositories, but each repository has at most one worktree within a topic.

## Common Mistakes

- Creating numbered artifact files by hand instead of via the CLI.
  - **Anti-pattern:** `write 02-auth.spec.md`, hand-editing STATE.md `specs:`/`artifacts:` registrations, or placing unnumbered `.md` files in the topic root.
  - **Correct:** `artifact-create` registers + creates the file; fill in content afterwards. A hand-created file is exactly what `verify` fails on — stop and redo via the CLI.
- Letting STATE.md drift: skipping the update when a spec is finalized or a milestone completes.
  - **Anti-pattern:** finishing work and leaving STATE.md stale until "later".
  - **Correct:** update STATE.md (body) or run `plan-status` in the same turn the progress happens. `verify` at session start exposes any drift.
- Editing the main checkout during topic work instead of the topic worktree.
  - **Anti-pattern:** implementing a spec in `/home/manooog/code/.../<repo>` because the main checkout already has node_modules/rush installed.
  - **Correct:** `guard` first — if it exits 1, create the topic worktree and work there. Main-checkout state (installed deps, running dev server) is not a reason to modify it.
- Analyzing repository code on a stale main checkout without running `gco-latest` first.
  - **Anti-pattern:** grepping `~/code/<repo>` for spec baseline while main is days behind `origin`.
  - **Correct:** `gco-latest ~/code/<repo>` once per repo per topic, then read/search; if it fails (dirty tree), stop and report.
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
  - **Anti-pattern:** Needing a plan for spec `02-fix-login-redirect` and running `artifact-create <topic> spec ...` to produce `03-fix-login-redirect-plan`.
  - **Correct:** Run `artifact-create <topic> plan 02`, which produces `02-fix-login-redirect.plan.md` and sets `plan: open`. Mark it `implemented` when done.
- Creating a plan for a spec the user has not accepted.
  - **Anti-pattern:** Spec passes the Determinism Gate, and you run `artifact-create <topic> plan <id>` in the same pass without pausing for the user to confirm the spec.
  - **Correct:** Finish and present the spec, wait for user acceptance (or an explicit "spec+plan together" ask), then run `artifact-create <topic> plan <spec-id>`. See the Spec → Plan confirmation gate.

### Rationalizations — no exceptions

| Excuse | Reality |
|---|---|
| "The user said skip verify, they're in a hurry" | The user asking to skip the check is the failure scenario it exists for. `verify` is one command; run it regardless. |
| "STATE.md can wait until the end" | "Later" means never. Update body/plan-status in the same turn progress happens. |
| "artifact-create registered it, that's enough" | Registration is the CLI's job; the body summary and progress notes are the LLM's job. Both are required. |
| "The file exists, just edit it directly" | A hand-created numbered file is the exact drift `verify` fails on. Recreate via `artifact-create`. |
| "Main is probably fine; I'll grep first" | Stale main produces wrong spec facts. `gco-latest` is one command; run it before the first repo analysis pass. |
| "gco-latest failed on dirty tree; I'll analyze anyway" | Dirty tree means main is not a reproducible baseline. Stop and report; do not guess. |
| "Spec is done — I'll start implementing while we're here" | Implementation requires an explicit user ask, a plan, worktree + `guard`, and (usually) `artifact-create <topic> plan <id>`. A finalized spec alone is not a go signal. |
| "The spec passed the check, so I'll write the plan in the same pass" | The plan commits to executing the spec; the user must accept the spec first. Stop, present, and wait — unless they explicitly asked for spec+plan together. |

### Rationalizations — no exceptions

| Excuse | Reality |
|---|---|
| "The user said skip verify, they're in a hurry" | The user asking to skip the check is the failure scenario it exists for. `verify` is one command; run it regardless. |
| "STATE.md can wait until the end" | "Later" means never. Update body/plan-status in the same turn progress happens. |
| "artifact-create registered it, that's enough" | Registration is the CLI's job; the body summary and progress notes are the LLM's job. Both are required. |
| "The file exists, just edit it directly" | A hand-created numbered file is the exact drift `verify` fails on. Recreate via `artifact-create`. |
| "Main is probably fine; I'll grep first" | Stale main produces wrong spec facts. `gco-latest` is one command; run it before the first repo analysis pass. |
| "gco-latest failed on dirty tree; I'll analyze anyway" | Dirty tree means main is not a reproducible baseline. Stop and report; do not guess. |
| "Spec is done — I'll start implementing while we're here" | Implementation requires an explicit user ask, a plan, worktree + `guard`, and (usually) `artifact-create <topic> plan <id>`. A finalized spec alone is not a go signal. |

## Red Flags

- A topic name that does not match `YYYY-MM-DD-<semantic>-<adj>-<noun>` is invalid.
- `session-topic verify <topic>` exits 1 — fix drift before any further topic work.
- A numbered artifact file exists that was not created via `artifact-create`.
- Handoff or UAT files must use `NN-<name>.handoff.md` / `NN-<name>.uat-case.md` in the topic root.
- Any unnumbered `.md` file in the topic root (other than `STATE.md`) fails `verify`.
- If `STATE.md` and the actual files disagree, trust the files and update `STATE.md`.
- Choosing a worktree path by hand instead of taking it from `worktree-path` output.
- Writing code before `guard` returns `ok`.
- Writing topic code anywhere other than the topic worktree.
- Grepping or reading project checkout for spec/plan work before `gco-latest` on that repo's main worktree.

## Analysis Baseline Rationalizations — STOP and Run gco-latest

| Excuse | Reality |
|--------|---------|
| "Main is probably fine; I'll grep first" | Stale main produces wrong spec facts. `gco-latest` is one command; run it before the first repo analysis pass. |
| "gco-latest failed on dirty tree; I'll analyze anyway" | Dirty tree means main is not a reproducible baseline. Stop and report; do not guess. |
| "I'm already in the topic worktree for implementation" | `gco-latest` targets **main worktree for analysis baseline**, not the implementation worktree. Use branch sync workflows there. |
| "gco-latest left main on detached HEAD — I should fix that before analyzing" | Detached at `origin/<default>` is the intended analysis state. Read/search; do not checkout a branch to edit. |
| "User only wants spec/skill work, but I need one grep to help" | Artifact-only scope does not waive `gco-latest` when you read project checkout. Run it first, or ask the user to refresh main. |

**All of these mean: stop, run `gco-latest` on main (or report the blocker), then analyze.**

## Code Location Rationalizations — STOP and Use the Worktree

| Excuse | Reality |
|--------|---------|
| "The main checkout already has node_modules/rush installed; a worktree needs a full reinstall" | Setup cost is not a reason to violate isolation. Create the worktree, re-run guard, then code. |
| "The change is small / additive / low-risk" | Size does not decide location. The rule is unconditional inside topic mode. |
| "I didn't commit, so the main checkout is safe" | Uncommitted edits on a detached or shared main checkout are exactly how work gets lost. "No commit" is not safety. |
| "I'll move it to a worktree after" | The worktree must exist BEFORE the first edit, not after. |

**All of these mean: stop, create the topic worktree, re-run guard, then code.**
