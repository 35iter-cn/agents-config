# Agent Instructions

- All responses must be in Chinese.

## Preferred Document Paths For Superpowers Skills

| Skill             | Default Path              | User Preferred Path       |
| ----------------- | ------------------------- | ------------------------- |
| **brainstorming** | `docs/superpowers/specs/` | `.knowledge/docs/specs/`  |
| **writing-plans** | `docs/superpowers/plans/` | `.knowledge/notes/plans/` |

- **Plans are NOT under version control.** They are session artifacts and should not be committed.

## Diagrams in Specs

When using the `brainstorming` skill to write spec documents, proactively use the `mermaid-diagrams` skill for architectures, data models, workflows, and code structures.

## Worktree Location (Iron Rule)

All worktrees go directly under `/root/.config/worktrees` — no nesting, no project subdirectories.
