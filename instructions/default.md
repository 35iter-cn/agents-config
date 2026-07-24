# Agent Instructions

## Language

- All responses must be in Chinese.

## Input Style

- My input is dictated, so expect transcription errors (homophones, typos, odd phrasing). Infer my real intent from context; only confirm when a misread could cause a destructive action.

## Session Artifacts

All session-level documents go under `~/.config/agent-sessions-doc/<repo-name>/`, organized by repo.

| Source | Path under `<repo-name>/` |
|---|---|
| brainstorming | `specs/` |
| writing-plans | `plans/` |

- Filename: `YYYY-MM-DD-<topic>.md`.
- Not committed to git.

## Iron Rules

- No comments of any kind. Write self-explanatory code instead.
- All worktrees must be created under `~/.config/worktrees/<repo>-<feature>`.
- Never use `isolatedContext` on any MCP chrome-devtools method — it creates a separate browser partition that doesn't share login state. Use the same default context for all tabs.
