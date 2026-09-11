---
name: session-topic
description: Use when creating, editing, or locating session artifacts (specs, plans, handoffs, UAT cases, notes, worktrees) under ~/.config/sessions/<topic>/, when spec or plan work needs reading project repository code, when a topic edit might land in the main checkout instead of the topic worktree, or when looking up an existing topic from a PR link, branch, repo, date, or keyword.
---

# Session Topic

## Overview

Session artifacts live under `~/.config/sessions/<topic>/`, never inside a project checkout. The CLI `session-topic.mjs` owns registration; you own content. Topic code changes happen only in the topic worktree. CLI paths are relative to this skill's directory, not the shell cwd.

## When to Use

- Writing specs, plans, handoffs, UAT cases, notes
- Reading or seeding project code for spec/plan work
- Resolving worktrees, registering PRs, locating a topic

When NOT: committed project files (use the repository); temporary files that need not outlive the session.

## Enforcement Checkpoints

| About to… | Must first… |
|-----------|-------------|
| Read/search a project checkout | `gco-latest` on its **main** worktree (once per repo per topic) |
| Write or edit project code | `guard` returns `ok` in the topic worktree |
| Create a numbered artifact | `artifact-create` — never `write` |
| Continue an existing topic | `verify` passes |
| Create a plan | Determinism Gate passed + user accepted the spec |
| Freeze a spec (`plan-status … implemented`) | Explicit user instruction only — never run unprompted |
| Create or replace a worktree | `worktree-check` passes |
| Locate a topic | `find` — never recursive grep |

User pressure does not waive these gates. Main worktree = read-only baseline (dirty tree → stop); topic worktree = the only place topic code is written. Details: `references/worktrees.md`.

## Spec Lifecycle

Editability follows plan status, not confirmation:

| Spec state | Editable? | Follow-up goes to |
|------------|-----------|-------------------|
| No plan yet, or `plan: open` | Yes — edit in place | Same spec; never a second spec for one task |
| `plan: implemented` | No — frozen | A new numbered spec |

- **Freeze is user-initiated.** All plan tasks verified + review passed → *suggest* freezing with an AC×task coverage table and the command — never run `plan-status` unprompted. Declined or silent user → stays `open` (status is truth); a later session re-offers the freeze before editing that spec.
- Revise in place: update the file, re-run the Determinism Gate and self-check, update its plan in the same pass if invalidated.
- A material revision (scope, acceptance, a settled decision) re-opens the confirmation gate; record it in STATE.md and commit it to the sessions git repo in the same turn (body = one-line summary, git diff = detail). Sessions root is a git repo; worktrees are gitignored.

## Core Flow

**First spec:** `init "<hint>"` (reuse the conversation's topic) → `artifact-create <topic> spec <name>` → `gco-latest` repos you read → `references/spec-writing-guide.md`, pass the Determinism Gate → **stop and confirm**; never auto-create the plan in the same pass.

**Continue:** locate (`references/locating-topics.md`) → `resolve` + read `STATE.md` → `verify` exits 0 → `gco-latest` each repo you read → update artifacts and STATE.md in the same turn.

**Spec → plan:** `artifact-create <topic> plan <spec-id>` (reuses the spec's number, `plan: open`) after the user accepts the spec, unless they asked for both together; then `references/implementation-flow-guide.md`. Plan tasks use the template in `references/plan-editing-guide.md` and reference the spec's `AC-N` ids.

**Code:** only in the topic worktree, at the `worktree-path` (`references/worktrees.md`).

## Quick Reference

Topic name: `YYYY-MM-DD-<semantic>-<adj>-<noun>`.

| Kind | Pattern (topic root) | Numbering |
|------|----------------------|-----------|
| Spec | `NN-<name>.spec.md` | spec/plan sequence |
| Plan | `NN-<name>.plan.md` (reuses the spec's number) | same sequence |
| Research / Handoff / UAT case / Notes | `D-NN-<name>.<type>.md` | `D-NN`, starts at D-01 |

`node session-topic.mjs --help` lists every command and flag. Worktrees: `worktree-<repo>/`; state: `STATE.md`.

## Common Mistakes

- Hand-creating numbered artifacts, editing STATE.md registrations, or letting STATE.md drift — the CLI owns registrations; update the body in the same turn progress happens.
- Stuffing knowledge (decisions, investigation, regression analysis) into STATE.md — it is a dashboard + index; knowledge lives in artifacts (see `references/state-md.md`).
- Editing the main checkout because dependencies are installed there. `guard` first.
- Worktree created or replaced without `worktree-check`, a branch switched inside an existing worktree, or analysis on a stale main checkout.
- A plan numbered anew instead of the spec's id.
- Session artifacts written inside the project checkout.

## Rationalizations — No Exceptions

| Excuse | Reality |
|--------|---------|
| "Skip verify, I'm in a hurry" | That is the failure scenario the check exists for. |
| "Main is probably fine / it's just a dirty tree" | Stale/dirty main is not a baseline; `gco-latest` first, on exit 1 stop. |
| "The change is small / low-risk" | Size does not decide location; the worktree rule is unconditional. |
| "Spec is done — I'll run plan-status myself" | Freeze is user-initiated. Suggest with the coverage table and wait. |
| "I'll just tweak the spec text, no need to re-confirm" | Editable is not unconfirmed; a material change re-opens the gate. |
| "Spec is done — I'll implement while we're here" | Needs an explicit ask, a plan, worktree + `guard`. |
| "The parked worktree looks empty; checks are ceremony" | `worktree-check` is the only preflight; dirty or unpushed work is lost. |

## Red Flags

- `verify` exits 1; STATE.md disagrees with the files (trust the files).
- A hand-picked worktree path; code written before `guard` returns `ok` or outside the topic worktree.
- A new branch matching a parked PR branch in `prs:`.
- Running `plan-status … implemented` without an explicit user instruction.
- A second spec while the same task's spec is `plan: open`; editing an `implemented` spec.

## References

Under `references/`: `spec-writing-guide.md` / `plan-editing-guide.md` / `implementation-flow-guide.md` / `handoff-writing-guide.md` cover authoring specs, editing plans, executing plans, and writing handoffs; `worktrees.md`, `locating-topics.md`, `state-md.md` cover the replace flow, `find`/`pr-add`, and STATE.md (numbering + body rules).
