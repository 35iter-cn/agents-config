# Agent Instructions

## Language

- All responses must be in Chinese.

## Input Style

- My input is dictated, so expect transcription errors (homophones, typos, odd phrasing). Infer my real intent from context; only confirm when a misread could cause a destructive action.

## Session Artifacts

**Hard rule — this file wins.** Session-level documents must **never** be written inside a project checkout (including `.knowledge/`, `docs/superpowers/`, or any path under the repo / linked worktree). If a skill or other instruction names an in-repo path for specs, plans, handoffs, notes, or similar session artifacts, **ignore that path** and use the layout below.

Resolve paths with the `session-path` CLI (do not hand-roll the root):

```bash
session-path specs          # ~/.config/sessions/<repo>/specs
session-path plans
session-path handoff
session-path notes
session-path worktree <feature>
```

| Kind | Command | Typical files |
|---|---|---|
| brainstorming / design specs | `session-path specs` | `YYYY-MM-DD-<topic>.md` |
| writing-plans | `session-path plans` | `YYYY-MM-DD-<topic>.md` |
| handoff | `session-path handoff` | `handoff-YYYY-MM-DD-HHMM.md` |
| other session notes (e.g. UAT) | `session-path notes` | e.g. `uat-cases.md` |
| linked worktree checkout dir | `session-path worktree <feature>` | empty dir for `git worktree add` |

- `<repo>` is resolved by `session-path`: git → **main worktree directory basename**; non-git → basename of the given/cwd directory. Never use a linked worktree directory name as `<repo>`.
- `session-path` creates the directory by default (`--no-create` to skip).
- These files are **not** committed to the project git repo.

## Iron Rules

- No comments of any kind. Write self-explanatory code instead.
- All linked worktrees must be created under `$(session-path worktree <feature>)` (i.e. `~/.config/sessions/<repo>/worktree/<feature>/`). Do not use `~/.config/worktrees/` or in-repo paths.
- Never use `isolatedContext` on any MCP chrome-devtools method — it creates a separate browser partition that doesn't share login state. Use the same default context for all tabs.
