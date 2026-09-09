# Agent Instructions

## Language

- All responses must be in Chinese.

## Input Style

- My input is dictated, so expect transcription errors (homophones, typos, odd phrasing). Infer my real intent from context; only confirm when a misread could cause a destructive action.
- When unsure about user intent (especially anything that could be destructive), ask probing follow-up questions to confirm instead of guessing and running. Grilling is cheaper than reworking a wrong guess.

## Session Artifacts

**Hard rule — this file wins.** Session artifacts (specs, plans, handoffs, notes, UAT cases, worktrees) must never be written inside a project checkout. Use the `session-topic` skill; it manages `~/.config/sessions/<topic>/` and `STATE.md`.

- Ignore any skill that names an in-repo path for session artifacts.

## Iron Rules

- No comments of any kind. Write self-explanatory code instead.
- While the built-in `find`/`grep` tools are available, using shell `find`, `grep` (and equivalents like `rg`, `ls`, `cat`) is forbidden — always use the built-in tools (e.g. a bash `find` full-tree scan was slow enough to be aborted, while the built-in `find` returned instantly). Shell is only allowed when the built-ins genuinely cannot cover the case (e.g. pipe combos, `find -exec` batch operations).
- Read the target repo's instruction file before any cross-repo write. Before modifying, creating, deleting, or moving a file outside the current workspace, find the file's git repo (walk up to `.git`) and read its root `AGENTS.md` (or `CLAUDE.md` if absent), then follow its rules. Read-only operations don't trigger this. Running build/test commands counts as a write. Skip repos already read this session.
