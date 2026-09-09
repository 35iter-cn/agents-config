# Handoff Writing Guide

Distilled from Matt Pocock's `handoff` skill (mattpocock/skills), adapted to the session-topic artifact system. The original writes to the OS temp directory; here the handoff is a topic artifact with a standard name.

## Core Principle

A handoff is **targeted compression** of a conversation (or one of its chapters) into a document a fresh agent can pick up cold. What it buys is **portability**, not compression.

Write one only when the work has to travel:

| Situation | Why a file |
| --- | --- |
| Swapping harness (e.g. Claude → Codex) | The new harness cannot see the old context |
| Moving to a different directory or repo | The new session starts elsewhere |
| Sending the work to a colleague | They need something they can read |
| Forking a side task found mid-phase | You keep working; a second agent takes the fork |

For same-session continuation (same harness, same directory, next phase of the same task), a summary or compaction is enough — do not write a handoff.

## What travels, and what doesn't

**Carries:**

- The live thread: what is in flight, why it is being done this way, what happens next.
- A **suggested skills** section naming which skills the next agent should load.
- When the request names a chapter/scope, the context, in-flight state, and next steps are scoped to that chapter — not the whole conversation.

**Never copies:**

- Anything already written down. Specs, plans, research docs, UAT cases, issues, commits, diffs are referenced by path (topic-relative or absolute) or URL — never pasted in. This keeps the file small and keeps settled detail in one place instead of two that drift.

**Never contains:**

- Secrets, API keys, tokens, passwords, PII — the document is read by other agents and may leave the machine.
- Beliefs written as facts. Anything the conversation assumed but did not verify must be marked as unverified ("assumed", "not yet checked") — the next agent treats the document as a contract and will not re-check it.

## Standard structure

```markdown
# Handoff D-NN: <concise title>

## Context
Why this work exists. 3–6 sentences. Point at the spec/plan/issues it derives from.

## In flight
What is currently in progress, the approach being taken, and why.

## Next steps
Ordered, concrete actions for the next agent.

## Suggested skills
Skill names the next agent should load, with a one-line reason each.

## Referenced artifacts
Paths/URLs to specs, plans, docs, PRs — referenced, never copied.
```

## Procedure

1. Resolve the topic (`session-topic.mjs resolve <topic>`; `init` if none).
2. Create the file via the CLI — never `write` a numbered filename directly:
   ```bash
   node session-topic.mjs artifact-create <topic> handoff <name>
   ```
3. Write the content to the printed path, following the structure above.
4. Run the self-check below before handing off.

## Self-check

- Readable cold, without the original session open, and the next steps are unambiguous.
- A fresh agent can start working instead of asking to re-explain the setup.
- A small fraction of the conversation; all settled detail appears as paths/URLs.
- Nothing in it is a key, token, or password; assumptions are marked as assumptions.
- If the fork case: the original session stays untouched — the handoff is a copy, not a move.