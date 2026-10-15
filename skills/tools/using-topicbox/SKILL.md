---
name: using-topicbox
description: Use before editing files in any repo for a task or fix (any size), and when advancing a claimed task or producing anything the user will revisit or act on later — a spec, plan, guide/攻略/travel plan, investigation, research, handoff — whether work or personal. Also use when resuming, locating, or handing over previous work from a PR link, branch, repo, date, or keyword. When any trigger matches, load this body before the first edit — deferring the read for a "trivial" job is the exact failure this skill exists to prevent.
---

# Using Topic Box

## Overview

A **topic** is one unit of work with a durable home: `~/.config/topicbox/<topic>/` holds the work's `STATE.md` (status dashboard + index, CLI-managed frontmatter) and its artifacts. A topic exists so that any agent — you later, another session, a different harness — can resume the work cold.

**The test is recoverability, never size or kind.** "Tiny fix", "not code", "nothing to write down" are not exemptions: what decides is whether someone will need to pick this work up later. Violating the letter of these rules is violating the spirit.

## When to Use

- **Before the first edit** of any fix or feature in a repo as part of a task you are doing or claimed — regardless of size; the trigger is the edit, not the size.
- Task advancement: board task taken up, spec or plan authored, investigation or analysis, a guide (攻略) or research piece, a handoff.
- Personal requests count: a trip guide you will consult tomorrow is recoverable work — the test never asks whether it is “work”.
- You need last time's work: continuing, locating, or preparing hand-over of prior work.
- NOT: pure Q&A or conversation; one-off read-only commands; content the user explicitly called temporary.

## Enforcement Checkpoints

| About to… | Must first… |
|-----------|-------------|
| Read/search a project checkout | `gco-latest` on its **main** worktree (once per repo per topic) |
| Write or edit project code | `topicbox guard <topic>` returns `ok` in the topic worktree |
| Create a numbered artifact | `topicbox artifact-create` — never `write` |
| Edit the STATE.md body — any change | `references/state-md-writing-guide.md` is mandatory reading first |
| Continue an existing topic | `topicbox verify <topic>` passes |
| Create a plan | Determinism Gate passed + user accepted the spec |
| Freeze a spec (`plan-status … implemented`) | Explicit user instruction only — never run unprompted |
| Create or replace a worktree | `topicbox worktree-check` passes |
| Locate a topic | `topicbox find` — never recursive grep |

User pressure does not waive these gates. Main worktree = read-only baseline for topic work (dirty tree → stop); the topic worktree is the only place topic code is written. Details: `references/worktrees.md`.

## Core Flow

**New topic:** `topicbox init "<hint>"` (reuse the conversation's topic) → `artifact-create <topic> spec <name>` → `gco-latest` repos you read → `references/spec-writing-guide.md`, pass the Determinism Gate → **stop and confirm**; never auto-create the plan in the same pass.

**Continue:** `topicbox find` → `topicbox resolve` + read `STATE.md` → `verify` exits 0 → `gco-latest` each repo you read → update artifacts and STATE.md in the same turn — every body change follows `references/state-md-writing-guide.md`.

**Spec → plan:** `artifact-create <topic> plan <spec-id>` after the user accepts the spec, unless they asked for both together; then `references/implementation-flow-guide.md`.

**Code:** only in the topic worktree, at the `worktree-path`.

**Non-code work** (guide, investigation, research): `init` + `D-NN` research/notes artifacts; STATE.md zones unchanged. No spec is required unless the work grows one.

**Work with an existing written source** (GitHub issue, existing doc): one pointer artifact naming the source of truth — never duplicate its content.

## Spec Lifecycle

Editability follows plan status, not confirmation:

| Spec state | Editable? | Follow-up goes to |
|------------|-----------|-------------------|
| No plan yet, or `plan: open` | Yes — edit in place | Same spec; never a second spec for one task |
| `plan: implemented` | No — frozen | A new numbered spec |

## Quick Reference

Topic name: `YYYY-MM-DD-<semantic>-<adj>-<noun>`.

| Kind | Pattern (topic root) | Numbering |
|------|----------------------|-----------|
| Spec | `NN-<name>.spec.md` | spec/plan sequence |
| Plan | `NN-<name>.plan.md` (reuses the spec's number) | same sequence |
| Research / Handoff / UAT case / Notes | `D-NN-<name>.<type>.md` | `D-NN`, starts at D-01 |

`topicbox --help` lists every command and flag. Worktrees: `worktree-<repo>/`; state: `STATE.md`.

## Common Mistakes

- Hand-creating numbered artifacts, or editing STATE.md registrations — the CLI owns registrations; the body is LLM-owned and follows `references/state-md-writing-guide.md`.
- Touching the STATE.md body without `references/state-md-writing-guide.md` — the recurring failure mode: completing a Todos item by checking `[x]` instead of deleting the line.
- Stuffing knowledge (decisions, investigation) into STATE.md — dashboard + index; knowledge lives in artifacts.
- Editing the main checkout because dependencies are installed there. `guard` first.
- Treating code-change sessions as artifact-optional — the topic rule is about recoverable work, not about file types.
- A plan numbered anew instead of the spec's id.

## Rationalizations — No Exceptions

| Excuse | Reality |
|--------|---------|
| "Tiny fix, not worth a topic" | Recoverability decides, size never does. Baseline test: an unfenced agent fixed, committed and pushed with no topic and no hesitation. |
| "It's not code — just a guide/analysis" | Topics hold any recoverable work; a guide is `init` + research artifacts. |
| "It's personal, not a work task" | Recoverability never asks whose work it is; a travel plan consulted tomorrow needs a durable home. Tested: an agent skipped a 攻略 on exactly this reasoning. |
| "User said do it my usual way" | The usual way IS the topic. Only an explicit "no topic" instruction skips it. Tested: an agent skipped on this phrase. |
| "Reading the skill body costs too much for this little thing" | The read is seconds; skipping it is how the baseline agent fixed, committed and pushed with no topic. Cost avoided = cost created. Tested: an agent deferred the read on exactly this reasoning. |
| "The issue/spec already exists — nothing to write" | Then the topic is `init` + one pointer artifact naming the source of truth. |
| "The change is small / low-risk" | Size does not decide location; the worktree rule is unconditional. |
| "Spec is done — I'll run plan-status myself" | Freeze is user-initiated. Suggest with the coverage table and wait. |
| "I'll just tweak the spec text, no need to re-confirm" | Editable is not unconfirmed; a material change re-opens the gate. |
| "Skip verify, I'm in a hurry" | That is the failure scenario the check exists for. |
| "Main is probably fine / it's just a dirty tree" | Stale/dirty main is not a baseline; `gco-latest` first, on exit 1 stop. |

## Red Flags

- `verify` exits 1; STATE.md disagrees with the files (trust the files).
- Code written before `guard` returns `ok` or outside the topic worktree; worktree created without `worktree-check`.
- Running `plan-status … implemented` without explicit user instruction.
- A second spec while the same task's spec is `plan: open`; editing an `implemented` spec.

## References

Under `references/`: `spec-writing-guide.md` / `plan-editing-guide.md` / `implementation-flow-guide.md` / `handoff-writing-guide.md` cover authoring specs, plans, execution discipline, and handoffs; `worktrees.md`, `locating-topics.md`, `state-md-writing-guide.md` cover the replace flow, `find`/`pr-add`, and the STATE.md body rules.