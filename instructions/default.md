# Agent Instructions

## Language

- All responses must be in Chinese.

## Input Style

- My input is dictated, so expect transcription errors (homophones, typos, odd phrasing). Infer my real intent from context; only confirm when a misread could cause a destructive action.

## Session Artifacts

**Hard rule — this file wins.** Session-level documents must **never** be written inside a project checkout (including `.knowledge/`, `docs/superpowers/`, or any path under the repo / linked worktree). If a skill or other instruction names an in-repo path for specs, plans, handoffs, notes, or similar session artifacts, **ignore that path**.

All session artifacts are managed by the `session-topic` skill. Invoke it before creating, reading, or updating any session artifact. It derives a topic from context, manages `~/.config/sessions/<topic>/`, and maintains `STATE.md`.

## Iron Rules

- No comments of any kind. Write self-explanatory code instead.
- All linked worktrees must be created under `$(node $CLAUDE_SKILL_DIR/session-topic.mjs worktree-path <topic> <repo>)` (i.e. `~/.config/sessions/<topic>/worktree-<repo>/`). Do not use `~/.config/worktrees/` or in-repo paths.
- Never use `isolatedContext` on any MCP chrome-devtools method — it creates a separate browser partition that doesn't share login state. Use the same default context for all tabs.
