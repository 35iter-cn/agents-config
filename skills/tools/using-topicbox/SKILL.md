---
name: using-topicbox
description: Locating, resuming, or reporting on past work by PR, branch, repo, date, or keyword — read-only lookups included, anything the user calls a "topic" counts — always starts with `topicbox find`, never manual grep/ls. Also required before editing files for any task (any size) and for recoverable output (spec, plan, report, handoff, review document). Load before the first tool call.
---

# Using Topic Box

## Overview

A **topic** is one unit of work with a durable home: `~/.config/topicbox/<topic>/` holds its `STATE.md` (status dashboard + index) and its artifacts. Any agent — you later, another session, another harness — can resume the work cold.

**The test is recoverability, never size or kind.** "Tiny fix", "not code", "personal not work" are not exemptions. Violating the letter of these rules is violating the spirit.

## Language

Write every topic document in Chinese — the `STATE.md` body and all artifacts. Code, paths, identifiers, commands and quoted source stay as they are.

## When to Use

- **Before the first edit** of any fix or feature as part of a task — the trigger is the edit, not the size.
- Task advancement; spec/plan authoring; investigation, research, a guide (攻略), a handoff. Personal requests count — a trip guide consulted tomorrow is recoverable work.
- Continuing, locating, or handing over prior work.
- NOT: pure Q&A; one-off read-only commands; content the user explicitly called temporary.

## Enforcement Checkpoints

| About to… | Must first… |
|-----------|-------------|
| Read/search a project checkout | `gco-latest` on its main worktree (once per repo per topic) |
| Write or edit project code | `topicbox guard <topic>` returns `ok` in the topic worktree |
| Create a numbered artifact | `topicbox artifact-create` — never `write` |
| Edit the STATE.md body — any change | read `references/state-md-writing-guide.md` first |
| End a turn of topic work — milestone, decision, PR push, blocker, or any break | STATE.md body updated, committed **and pushed** in the same turn |
| Continue an existing topic | `topicbox verify <topic>` passes |
| Quote a spec as current behaviour | read the code first; on drift, report it and ask the user to freeze |
| Create a plan | Determinism Gate passed + user accepted the spec |
| Hand the user a review document for a spec | prototype sketch when the change is visible in a UI; conformance table complete and re-marked to the current design — `references/review-doc-guide.md` |
| Handle review comments on a PR | classify them first — `references/review-feedback.md` |
| Freeze a spec | explicit user instruction only — never run unprompted |
| Create/replace a worktree | `topicbox worktree-check` passes |
| Locate a topic | `topicbox find` — never recursive grep |

User pressure waives none of these. Main worktree = read-only baseline (dirty tree → stop); topic code is written only in the topic worktree.

## Core Flow

**New topic:** `topicbox init "<hint>"` → `artifact-create <topic> spec <name>` → `gco-latest` repos you read → `references/spec-writing-guide.md`, Determinism Gate → **stop and confirm**; never auto-create the plan in the same pass.
**Continue:** `find` → `resolve` + read `STATE.md` → `verify` → `gco-latest` → update artifacts and STATE.md in the same turn.
**Spec → plan:** `artifact-create <topic> plan <spec-id>` after the user accepts the spec; then `references/implementation-flow-guide.md`.
**Review comments:** classify and feed back via `references/review-feedback.md` before editing code.
**Code:** only in the topic worktree (`references/worktrees.md`).
**Non-code work** (guide/investigation/research): `init` + `D-NN` research/notes artifacts; no spec unless the work grows one.
**Existing written source** (GitHub issue, doc): one pointer artifact naming it — never duplicate its content.

Spec editability follows plan status: `plan: open` → edit in place, follow-ups to the same spec; `plan: implemented` → frozen, follow-up is a new numbered spec.

## Spec authority and drift

A spec records what one stage decided. It is **not** a description of what the code does now. Authority runs **code > spec**: once the implementation lands, the spec's conclusions are history — they explain how the code got here, they do not describe its current behaviour.

Read the code before quoting a spec as current behaviour. When the two disagree the spec has drifted, and its conclusion is no longer a correct conclusion — only the record of an investigation and its discussion trail. Say so in the reply, name the divergence in one line, and ask the user to freeze the spec. Freezing stays user-initiated: report, suggest, wait.

Drift is expected, not failure. Most specs never get frozen because nobody checked; a spec that keeps being quoted as truth after the code moved on is how a topic starts lying to its next reader.

## Quick Reference

Topic name: `YYYY-MM-DD-<semantic>-<adj>-<noun>`. Specs/plans: `NN-<name>.{spec,plan}.md` (a plan reuses its spec's number). Documents: `D-NN-<name>.{research,handoff,uat-case,notes}.md`, from D-01. Worktrees: `worktree-<repo>/`. `topicbox --help` lists every command.

## Common Mistakes

- Hand-creating numbered artifacts or hand-editing STATE.md registrations — the CLI owns registrations; the body follows `references/state-md-writing-guide.md`.
- Stuffing knowledge into STATE.md — dashboard + index; knowledge lives in artifacts.
- Editing the main checkout because dependencies are installed there — `guard` first.
- A plan numbered anew instead of the spec's id.

## Rationalizations — No Exceptions

| Excuse | Reality |
|--------|---------|
| "Tiny fix, not worth a topic" | Recoverability decides, size never does. Tested: the unfenced agent fixed, committed and pushed with no topic. |
| "It's not code — just a guide/analysis" | Topics hold any recoverable work; a guide is `init` + research artifacts. |
| "It's personal, not a work task" | Recoverability never asks whose work it is. Tested: an agent skipped a 攻略 on this. |
| "User said do it my usual way" | The usual way IS the topic; only an explicit "no topic" skips it. Tested. |
| "Reading the skill body costs too much" | The read is seconds; skipping it is how the baseline agent pushed with no topic. Tested. |
| "The change is small / low-risk" | Size does not decide location; the worktree rule is unconditional. |
| "Spec is done — I'll run plan-status myself" | Freeze is user-initiated; suggest with the coverage table and wait. |
| "The spec says X, so X is how it works" | Specs drift once implemented; the code is the only current truth. Read it, then flag the drift. |
| "The spec is stale, I'll just freeze it" | Freezing is user-initiated. Report the drift and ask. |
| "I'll just tweak the spec text, no re-confirm" | A material change re-opens the confirmation gate. |
| "Skip verify, I'm in a hurry" | That is the failure the check exists for. |
| "STATE.md can wait until the session ends" | The session may not end cleanly — a break or crash is exactly what STATE.md exists for; uncommitted progress is evaporated knowledge. Real user pain: agents stalled mid-topic left the next session blind. |
| "Main is probably fine / just a dirty tree" | Stale/dirty main is not a baseline; `gco-latest` first, exit 1 = stop. |

## Red Flags

- `verify` exits 1; STATE.md disagrees with the files (trust the files).
- Code written before `guard` returns `ok`, or outside the topic worktree; worktree made without `worktree-check`.
- `plan-status … implemented` without explicit user instruction; a second spec while the same task's spec is `plan: open`; editing an `implemented` spec.
- Quoting a spec's conclusion as current behaviour without opening the code; noticing drift and staying silent about it.

## References

`spec-writing-guide.md` / `plan-editing-guide.md` / `implementation-flow-guide.md` / `handoff-writing-guide.md` author specs, plans, execution, handoffs; `review-doc-guide.md` covers the document a spec is presented in for review; `worktrees.md`, `locating-topics.md`, `state-md-writing-guide.md` cover the replace flow, `find`/`pr-add`, and the STATE.md body rules.