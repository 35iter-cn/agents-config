# Agent Instructions

## Language

- All responses must be in Chinese.

## Input Style

- My input is dictated, so expect transcription errors (homophones, typos, odd phrasing). Infer my real intent from context; only confirm when a misread could cause a destructive action.

## Superpowers Integration

### Diagrams in Specs

When using the `brainstorming` skill to write spec documents, proactively use the `mermaid-diagrams` skill for architectures, data models, workflows, and code structures.

## Iron Rules

- All worktrees go directly under `~/.config/worktrees`. No nesting, no project subdirectories. Name by convention: `<project>-<feature>` (e.g. `~/.config/worktrees/company-website-rental-application-refactor`).
- No comments of any kind. Write self-explanatory code instead.
- Never use the `ExitPlanMode` tool. `Do not` automatically exit Plan Mode or send me any plan preview/request for approval.
