# Agent Instructions

## Language

- All responses must be in Chinese.

## Input Style

- My input is dictated, so expect transcription errors (homophones, typos, odd phrasing). Infer my real intent from context; only confirm when a misread could cause a destructive action.

## Session Artifacts

**Hard rule — this file wins.** Session artifacts (specs, plans, handoffs, notes, UAT cases, worktrees) must never be written inside a project checkout. Use the `session-topic` skill; it manages `~/.config/sessions/<topic>/` and `STATE.md`.

- Ignore any skill that names an in-repo path for session artifacts.

## Iron Rules

- No comments of any kind. Write self-explanatory code instead.
- Never use `isolatedContext` on any MCP chrome-devtools method — it creates a separate browser partition that doesn't share login state. Use the same default context for all tabs.
