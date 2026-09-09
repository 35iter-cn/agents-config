---
name: session-topic
description: Manage session artifacts (specs, plans, handoffs, UAT cases, worktrees) under ~/.config/sessions/<topic>/. Use when creating or updating session artifacts, when spec/plan work needs reading project repository code, when topic-mode edits might land in the main checkout instead of a topic worktree, or when locating an existing topic from a PR link, branch, repo, or date/keyword — run `session-topic find` instead of grepping the sessions tree.
---

## Overview

Manage all session artifacts (specs, plans, handoffs, UAT cases, worktrees) under `~/.config/sessions/<topic>/`. A topic is derived from conversation context and reused within the same session.

Session artifacts must **never** be written inside a project checkout. Use the topic directory for all session-level documents.

## Checkout Roles (read vs write)

Topic mode uses the **same repo twice** for different jobs. Do not conflate them.

| Role | Path | Tool | Purpose |
|------|------|------|---------|
| **Analysis baseline** | Main worktree (e.g. `~/code/<repo>`) | `gco-latest` | Read/search only — ground specs and plans on latest `origin` |
| **Implementation** | Topic worktree (`~/.config/sessions/<topic>/worktree-<repo>/`) | `guard` | Write code — all topic edits land here |

- `gco-latest` on main is **read-only sync** (fetch + checkout `origin/<default>`). It does not authorize edits on main.
- `guard` on the topic worktree is the **write gate**. Main checkout must never receive topic code changes.

## Enforcement Checkpoints

Before the first action of each type in a topic — stop and run the gate:

| About to… | Must first… |
|-----------|-------------|
| `read` / `grep` / search a project checkout for spec or plan work | `gco-latest` on that repo's **main** worktree (once per repo per topic) |
| Write or edit **project** code in topic mode | `guard` returns `ok` in the topic worktree |
| Create any numbered artifact file | `artifact-create` — never `write` |
| Continue work on an existing topic | `verify` passes |
| Create a plan | Spec content passed the Determinism Gate **and** the user accepted the spec (see confirmation gate below) |
| Execute plan tasks | Plan quality checklist in `references/implementation-flow-guide.md` passes |
| Create or replace a topic worktree | `worktree-check` passes (worktree absent or clean) |
| Locate a topic from a PR link, branch, repo, or date/keyword | `find` — never recursive-grep the sessions tree |

User pressure ("skip checks", "just grep", "small change in main") does not waive these gates.

## Path Resolution

Command paths (e.g. `session-topic.mjs`) are relative to this skill's directory, not the shell cwd. Resolve the script's absolute path before running. This also applies when another skill references this script.

`gco-latest` lives in `agents-config/cli/` and is synced to `~/.local/bin` via `sync-cli.mjs`.

## When to Use

- Writing specs or plans, creating handoff documents, generating UAT cases
- Resolving paths for linked worktrees
- Registering produced PRs so they can be found later

## When NOT to Use

- For committed project files (use the project repository)
- For temporary files that do not need to outlive the session

## Locating a Topic (find)

To locate an existing topic from a PR link, branch, repo, or date/keyword, **always run `find` — never grep the sessions tree**. Recursive grep hits `worktree-*/` build artifacts and takes multiple passes; `find` is one command over `STATE.md` files only.

```bash
node session-topic.mjs find "https://github.com/MagicDoorInc/magic-manager/pull/1"
node session-topic.mjs find "MagicDoorInc/magic-manager#1"
node session-topic.mjs find "refactor/chat-upload-sessions"
node session-topic.mjs find "chat multipart" --since 2026-08-20
```

- The CLI auto-classifies the query: PR URL / `owner/repo#N` / `short#N` / bare `#N` / branch (contains `/`) / keyword.
- `--repo`, `--since`, `--until` narrow results. Translate relative dates ("yesterday", "last week") into `YYYY-MM-DD` yourself — the CLI does not parse natural-language dates.
- Matching layers, most reliable first: frontmatter `prs:` registry → canonical `owner/repo#N` refs in body → full PR URLs → bare `PR #N` inside a `worktree-<repo>` bullet (repo inferred from the bullet) → loose/keyword (candidates; loose hits are marked `[unconfirmed]`).
- Bare `#N` collides across repos (backend #1 vs magic-manager #1): find lists all candidates, it never guesses.
- Output is a ranked candidate list, never a single verdict. Read the top candidate's `STATE.md` to confirm before continuing work in it.

## Registering a PR (pr-add)

When topic work produces a PR, register it **in the same turn** so future `find` queries hit the registry directly:

```bash
node session-topic.mjs pr-add <topic> <pr-url-or-owner/repo#N> [--branch <branch>]
```

- Entry shape (frontmatter, CLI-owned): `prs:` array of `{ repo: full slug, number, branch? }`. The registry is an **index, not a mirror** — no status/title fields; those stay in body narrative.
- Idempotent: re-registering an existing repo+number only updates `branch`.
- Legacy topics are never backfilled; for them `find` relies on body layers (URL / worktree-bullet), which is by design.

## Topic Naming and Lifecycle

A topic directory name has the form:

```
YYYY-MM-DD-<semantic>-<adjective>-<noun>
```

- `YYYY-MM-DD`: creation date
- `<semantic>`: 1-3 kebab-case words describing the goal, derived from context
- `<adjective>-<noun>`: random suffix to ensure uniqueness, reused from the `words/` companion word lists

Lifecycle:

1. If the conversation context already has a topic, reuse it.
2. If not, derive a semantic hint from the user's request and run `node session-topic.mjs init <semantic-hint>` — it prints the full topic name.
3. Remember the topic in the conversation context for reuse.

### File Conventions

The CLI is the only writer of numbered filenames. Never hand-create or rename numbered files; `verify` rejects unregistered files of any type and any unnumbered `.md` file in the topic root. Truly temporary content does not belong in the topic directory.

Under the topic directory:

| Kind | Pattern | Numbering |
|---|---|---|
| Spec | `NN-<name>.spec.md` — topic root only, never under `specs/` | spec/plan sequence, globally unique, increasing |
| Plan | `NN-<name>.plan.md` — topic root only, reuses the spec's number and name | same sequence (reuses spec number) |
| Research | `D-NN-<name>.research.md` — topic root only | independent sequence, starts at D-01 |
| Handoff | `D-NN-<name>.handoff.md` — topic root only | same independent sequence |
| UAT case | `D-NN-<name>.uat-case.md` — topic root only | same independent sequence |
| Notes | `D-NN-<name>.notes.md` — topic root only | same independent sequence |
| Worktree | `worktree-<repo>/` | — |
| State | `STATE.md` | — |

**Dual numbering**: the spec/plan sequence and the `D-NN` document sequence increment independently and never take numbers from each other. Legacy documents (bare `NN-` prefixed research/handoff/uat-case/notes) keep their original numbers; migrate them opportunistically, never force renames. Document numbers are never reused — `artifact-remove` tombstone lines still occupy their number. When referencing a document, always include the type word or prefix ("spec 24", "D-01") — never a bare number.

Legacy topics (e.g. handoff/UAT files with a free `<prefix>` form) migrate opportunistically when `verify` is next run on them. The mature example topic `2026-08-09-app-fee-online-curious-temple` shows the intended STATE.md body pattern; numbered filenames there may still be legacy until migrated.

## CLI Commands

```bash
node session-topic.mjs init <semantic-hint>
node session-topic.mjs resolve <topic>
node session-topic.mjs artifact-create <topic> <type> <name-or-spec-id>
                                    # types: spec | plan | research | handoff | uat-case | notes
                                    # plan uses spec id; others use artifact name
node session-topic.mjs plan-status <topic> <spec-id> <open|implemented>
node session-topic.mjs artifact-remove <topic> <id> [--reason <text>]
                              # hard-delete a non-spec artifact (file + registration),
                              # tombstone appended to STATE.md body; specs/plans never removable
node session-topic.mjs verify <topic>                  # exit 1 if STATE.md drifts from artifact files
node session-topic.mjs worktree-check <topic> --repo <main-checkout-path>
                              # Read-only preflight: clean gate + pushed/PR report + baseline snapshot
node session-topic.mjs worktree-path <topic> [dir]
node session-topic.mjs guard <topic> [dir]   # exit 1 unless $PWD is the topic worktree
node session-topic.mjs find <query> [--repo r] [--since d] [--until d]
node session-topic.mjs pr-add <topic> <pr-url|owner/repo#N> [--branch b]

gco-latest /path/to/<repo-main-worktree>   # sync main to origin before first repo analysis pass
```

## Core Flow

### Creating the First Spec

1. Derive a semantic hint from the user's request (e.g. `auth refactor`).
2. Create the topic:
   ```bash
   topic=$(node session-topic.mjs init "auth refactor")
   ```
3. Create the first spec via the CLI — never with `write`:
   ```bash
   node session-topic.mjs artifact-create "$topic" spec "auth-refactor"
   ```
4. If writing the spec requires reading or searching project repository code, run `gco-latest` on each affected repo's **main worktree** (see Repository Analysis Baseline).
5. Read `references/spec-writing-guide.md` first for structure, diagram conventions, and anti-patterns, then write the spec content to the printed path. Run the Spec Content Self-Check (Determinism Gate) before considering the content written — an open question in the spec is an unfinished spec.
6. **Stop and confirm the spec with the user.** Do not auto-create the plan in the same pass.

### Spec → Plan Confirmation Gate

A plan is a commitment to execute a spec. **Never create a plan for a spec the user has not accepted.** After the spec content passes the Determinism Gate, **stop and confirm with the user before running `artifact-create <topic> plan <spec-id>`** — do not auto-produce a plan in the same pass.

- The spec is the decision document; the plan presumes the design is accepted. Auto-creating a plan commits to execution before the user has approved the design, and a plan built on an unconfirmed spec is throwaway if the spec is rejected or reworked.
- The only exception: the user explicitly asked for spec and plan together in one pass (e.g. "write the spec and plan"). Then produce both, still pausing to confirm the spec before *implementing*.
- An explicit user instruction to implement a specific already-discussed change ("fix X now", "deploy Y") counts as acceptance — record it in STATE.md and proceed.
- When in doubt, finish the spec, present it, and wait. Confirming costs one round-trip; rebuilding a plan from a rejected spec costs more.

### Continuing Work on an Existing Topic

1. Read the current topic from conversation context, or locate it with `find`.
2. Resolve the topic directory: `node session-topic.mjs resolve <topic>`.
3. Read `STATE.md` to understand current progress.
4. Run `session-topic verify <topic>` — MUST pass before any further work. If it exits 1, fix the listed drift and re-run. A failing verify means the topic state is untrustworthy; do not create specs, plans, worktrees, or code until it passes.
5. If the task will read or search project repository code, run `gco-latest` on each affected repo's **main worktree** before the first analysis pass.
6. Create or update files as needed.

**Scope boundary:** If the user restricts work to artifacts only (spec review, skill edit, planning discussion) and explicitly says not to implement — do not create a plan, worktree, or project code edits. Finishing a spec is not permission to start implementation unless the user asks.

### Bug Fixes and Follow-Up Work

When a spec is already finalized and additional work is needed, do not edit the spec. Create a new numbered spec instead:

```bash
node session-topic.mjs artifact-create <topic> spec "fix-login-redirect"
```

Then create its plan with `artifact-create <topic> plan <new-spec-id>`.

### Plan Creation and Task Execution

- **Plan creation**: run `artifact-create <topic> plan <spec-id>` (produces `NN-<name>.plan.md`, sets `plan: open`). Read `references/implementation-flow-guide.md` and run its plan quality checklist against the plan before the first task.
- **Task execution**: `references/implementation-flow-guide.md` owns the task execution loop, the per-task review gate (self-review thresholds vs whole-diff review), the self-review checklist, and close-out (`plan-status` → STATE.md → `pr-handoff` → `pr-add`). Follow it; this file deliberately does not duplicate those rules.
- Do not start execution while the worktree is missing or `guard` is not `ok`.

### Worktrees (Mandatory for Code Changes)

**Topic-mode code changes happen ONLY inside the topic worktree. The main checkout is never modified for topic work.** This is a hard rule, not a preference.

**Worktree path source is authoritative.** The worktree path MUST come from `node session-topic.mjs worktree-path <topic>` output — never a hand-chosen path (project sibling, `/tmp`, etc.). A hand-picked path is a violation even if it looks reasonable.

**Invariant: at most one worktree per repo per topic at any time.** A topic may accumulate multiple PRs in the same repo, but never multiple live worktrees. Starting a new independent spec in a repo whose worktree is occupied by a parked (unmerged) PR is a **replace, not a branch switch** — never checkout a different branch inside the existing worktree.

**Replace flow (new spec in a repo that already has a worktree):**

1. Preflight — read-only, no git mutations:
   ```bash
   node session-topic.mjs worktree-check <topic> --repo <path-to-main-checkout>
   ```
   MUST pass (exit 0): worktree absent, or present and clean. FAIL = stop, resolve, re-run. The report also covers push state, PR registration in STATE.md `prs:`, and an origin baseline snapshot — treat every FAIL item as a blocker.
2. Retire the old worktree:
   ```bash
   git worktree remove <worktree-path>
   ```
   The local branch is **kept** — it is the recovery anchor of the parked PR.
3. Create the new worktree (path from `worktree-path`, based on latest `origin/<default>` — run `gco-latest` on the main checkout first so the branch is not cut from stale code):
   ```bash
   git worktree add "<worktree-path>" -b <branch> <base>
   ```
   Choose the branch name from context. **Never reuse a branch already registered in STATE.md `prs:` for that repo** (check `git branch -a` and the registry) and never base a new spec's branch on another spec's PR branch.
4. Write gate:
   ```bash
   node session-topic.mjs guard <topic>   # exit 1 unless $PWD is the topic worktree
   ```
   Must return `ok` before the first write, and re-run on every write-critical action (edits, builds, tests) — the shell cwd drifts across a long session.

**guard blind spot:** `guard` validates location only, not branch. An `ok` inside a worktree whose branch belongs to another spec's parked PR is a false pass — branch correctness comes from the worktree-check report and the branch↔spec records in the STATE.md body.

**After retiring a worktree:** keep the frontmatter `prs:` entry and update the STATE.md body bullet (branch, HEAD, PR number, parked/merged status) — the body is the only durable map of parked branches.

A topic may span multiple repositories, but each repository has at most one worktree within a topic.

### Merging / Cleaning Up Documents

1. Create the target artifact via `artifact-create` (it allocates the next D-NN slot).
2. Merge content in by hand (the CLI only manages registration, not content).
3. Remove each source document via `artifact-remove <topic> <id> --reason "merged into D-NN"` — file + registration go together, a tombstone line lands in STATE.md body.
4. Update STATE.md body and any surviving documents that referenced the removed numbers (old → new mapping is in the tombstones).
5. Run `verify` — must pass.

Specs/plans are never removable: even a wrong spec is a complete implementation-chain record kept for retrospection.

### Writing a Handoff

Handoffs are for work that has to travel (harness swap, directory/repo move, colleague, side-task fork) — for same-session continuation a summary is enough. When one is warranted, create it via `artifact-create <topic> handoff <name>` and follow `references/handoff-writing-guide.md` for when to write one, the standard structure, and the self-check. This file deliberately does not duplicate those rules.

## STATE.md

Two responsibilities, two owners:

- **Frontmatter (registrations) is owned by the CLI.** `specs:` entries (spec + plan status) and `artifacts:` entries (research, handoff, uat-case, notes) are added only via `artifact-create` / `plan-status`. Removal is also CLI-only: `artifact-remove` is the single legal deletion path — never hand-delete a registered file, never hand-edit registrations. Never create numbered artifact files with `write` — that is exactly the drift `verify` exists to catch.
- **`artifacts:` shape:** array of `{ id, name, type, file }` where `type` is one of `research | handoff | uat-case | notes` and `file` is the basename (e.g. `02-bar.research.md`). `init` creates `artifacts: []`.
- **Body is owned by the LLM and SHOULD be actively maintained.** Keep a `# Session State` summary (spec progress table, worktree status, artifacts) plus durable conclusions (decisions, milestone progress, architecture notes) worth carrying across sessions — see mature topics like `2026-08-09-app-fee-online-curious-temple` for the pattern. The CLI preserves the body when it rewrites STATE.md.
- **PR references in the body:** outside a `worktree-<repo>` bullet, use canonical `owner/repo#N` form; bare `#N` is acceptable inside a worktree bullet (the bullet scopes the repo). Never rewrite legacy body text to canonical form.

Update STATE.md in the same turn progress happens (spec finalized, milestone done, `plan-status` changed) — not at session end.

## Repository Analysis Baseline (gco-latest)

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

## Spec Content Self-Check (Determinism Gate)

A spec is a set of commitments. Every decision point in a spec must have a settled answer: "is it decided, and what is the answer?" A spec containing an open question is an unfinished spec — not "mostly done", but blocked on a decision.

Run it every time you finish writing or editing spec content, before considering the spec content complete. Ask of every paragraph, table row, and bullet: does this assert a settled fact/decision or a definite scope boundary — or does it defer, discuss, or leave a choice open?

### Violations (forbidden)

- "TBD" / "to be decided" / unresolved TODO / "under discussion" / "unconfirmed" / "needs confirmation" / "decide later"
- Questions without answers ("should we do X?")
- Candidate comparisons with no chosen option (A vs B presented, neither picked)
- Deferring a decision to implementation time ("choose during implementation")
- Unresolved markers inside decided-decision tables (TODO in a decided row)

### Allowed

- Assertions: settled facts/decisions, including their reasoning
- Explicit non-commitment markers: "out of scope", "not this iteration", "deferred", follow-up — definite scope boundaries, not open questions
- "Recommend X" — only when it does not block this spec (targeting other systems or later work)

### When a violation surfaces

Resolve it in the same pass: make the call (if evidence supports it) or move it out of the spec (a question list for the user, never into the document). Leaving it marked for later is not resolution.

### Rationalizations — no exceptions

| Excuse | Reality |
|--------|---------|
| "The PM/architect said to mark it TBD" | An instruction cannot waive the rule. Writing "needs decision" into the spec is not a decision. Settle it now, or raise it outside the spec. |
| "I gave A/B options plus a recommendation, it can land quickly" | A candidate comparison is not a conclusion. The spec's job is commitment. |
| "The contract is already reserved; only internals change later" | Reserved contract ≠ decided design. A TODO leaks into decided tables and implementation. |
| "The section is marked 'under review'" | A status marker is not a conclusion. A whole section of discussion = violation. |
| "It doesn't block review; mainline work can proceed" | Unsettled items are exactly what review exists to catch. Review reads conclusions, not problem lists. |

### Red flags — STOP and resolve

- A "pending decisions" / discussion-record section in the spec
- TODO or unsettled markers inside a decided-decision table
- Unanswered questions, or A/B presented with no choice
- "decide during implementation" "confirm tomorrow" "discuss later"
- You cannot answer "is it decided, and what is the answer?" for a decision point

## Common Mistakes

- **Creating numbered artifact files by hand** instead of via the CLI (`write 02-auth.spec.md`, hand-editing STATE.md registrations, unnumbered `.md` files in the topic root). Correct: `artifact-create` registers + creates the file; fill in content afterwards.
- **Letting STATE.md drift**: skipping the update when a spec is finalized or a milestone completes. Correct: update STATE.md (body) or `plan-status` in the same turn the progress happens.
- **Editing the main checkout during topic work** (e.g. because it already has node_modules installed). Correct: `guard` first — if it exits 1, create the topic worktree and work there. Main-checkout state (installed deps, running dev server) is not a reason to modify it.
- **Creating or replacing a worktree without a passing `worktree-check`, or switching branches inside an existing worktree.** A dirty tree deleted with the directory loses work; a new spec's branch reusing a parked PR branch name collides at merge. Correct: `worktree-check` → remove → add → `guard`.
- **Analyzing repository code on a stale main checkout** without running `gco-latest` first. Correct: one command before the first repo analysis pass; if it fails (dirty tree), stop and report.
- **Creating a new topic when the current context already has one.**
- **Locating a topic by recursive grep** over `~/.config/sessions/` — hits `worktree-*/` build artifacts. Correct: `session-topic find`.
- **Editing an already-finalized spec** instead of creating a new numbered spec for follow-up work.
- **Forgetting to update `plan-status`** after a plan has been executed.
- **Writing session artifacts inside the project checkout.** Helper scripts, seed SQL, or e2e flow files that support a specific session belong in the topic directory, not the worktree or repo — they risk accidental commits and vanish when the worktree is removed.
- **Creating a plan with a new number** instead of reusing the spec's id. Correct: `artifact-create <topic> plan 02` produces `02-<name>.plan.md`.
- **Creating a plan for a spec the user has not accepted.** See the Spec → Plan confirmation gate.

## Rationalizations — No Exceptions

| Excuse | Reality |
|--------|---------|
| "The user said skip verify, they're in a hurry" | The user asking to skip the check is the failure scenario it exists for. `verify` is one command; run it anyway. |
| "STATE.md can wait until the end" | "Later" means never. Update body/plan-status in the same turn progress happens. |
| "artifact-create registered it, that's enough" | Registration is the CLI's job; the body summary and progress notes are the LLM's job. Both are required. |
| "The file exists, just edit it directly" | A hand-created numbered file is the exact drift `verify` fails on. Recreate via `artifact-create`. |
| "Main is probably fine; I'll grep first" | Stale main produces wrong spec facts. `gco-latest` is one command; run it before the first repo analysis pass. |
| "gco-latest failed on dirty tree; I'll analyze anyway" | Dirty tree means main is not a reproducible baseline. Stop and report; do not guess. |
| "I'm already in the topic worktree for implementation" | `gco-latest` targets the **main worktree for analysis baseline**, not the implementation worktree. Use branch sync workflows there. |
| "The change is small / additive / low-risk" | Size does not decide location. The worktree rule is unconditional inside topic mode. |
| "I didn't commit, so the main checkout is safe" | Uncommitted edits on a shared main checkout are exactly how work gets lost. |
| "I'll move it to a worktree after" | The worktree must exist BEFORE the first edit, not after. |
| "The parked worktree looks empty; checks are ceremony" | A dirty tree or unpushed commits deleted with the directory are lost work. `worktree-check` is the only preflight. |
| "Main checkout already has node_modules/rush installed; a worktree needs a full reinstall" | Setup cost is not a reason to violate isolation. |
| "The spec passed the check, so I'll write the plan in the same pass" | The plan commits to executing the spec; the user must accept the spec first. Stop, present, and wait — unless they explicitly asked for spec+plan together or explicitly ordered implementation. |
| "Spec is done — I'll start implementing while we're here" | Implementation requires an explicit user ask, a plan, worktree + `guard`, and (usually) `artifact-create <topic> plan <id>`. A finalized spec alone is not a go signal. |

## Red Flags

- A topic name that does not match `YYYY-MM-DD-<semantic>-<adj>-<noun>` is invalid.
- `session-topic verify <topic>` exits 1 — fix drift before any further topic work.
- A numbered artifact file exists that was not created via `artifact-create`.
- Any unnumbered `.md` file in the topic root (other than `STATE.md`) fails `verify`.
- If `STATE.md` and the actual files disagree, trust the files and update `STATE.md`.
- Choosing a worktree path by hand instead of taking it from `worktree-path` output.
- Writing code before `guard` returns `ok`.
- Writing topic code anywhere other than the topic worktree.
- A new worktree branch whose name matches a parked PR branch in `prs:`.
- Grepping or reading a project checkout for spec/plan work before `gco-latest` on that repo's main worktree.