# AI-taught-me Common Conventions

## Repository Path

`/root/code/AI-taught-me`

## Directory Structure

```
/root/code/AI-taught-me/
├── {category}/              # Top-level topic grouping (e.g., git-workflow, debugging, tools)
│   └── {topic}/             # Specific topic directory
│       ├── report.md        # Full case study with context and narrative
│       └── cheat-sheet.md   # Quick command reference, no narrative
└── README.md
```

Two-level nesting: `category/topic/`. Never go deeper.

## File Naming

| File | Purpose |
|------|---------|
| `report.md` | Full case study: context, problem, solution, verification, recovery |
| `cheat-sheet.md` | Quick lookup: commands, checklists, common errors |
| `README.md` | Category overview (optional) |

## Core Principles

| Principle | Meaning |
|-----------|---------|
| **Searchable** | Use keywords Claude would search for (technology names, actions, symptoms, tools) |
| **Self-contained** | Document includes context, not just commands |
| **Two formats** | Full report + cheat sheet for different needs |
| **Dated** | Include date in frontmatter for temporal context |

## Keyword Strategy

Include these keyword types in content (not just filename):
- **Technologies:** git, docker, kubernetes, typescript, rush
- **Actions:** rebase, cleanup, debug, deploy, migrate
- **Symptoms:** conflict, error, hang, slow, fail
- **Tools:** specific commands, flags, options

## Report Template

```markdown
---
date: YYYY-MM-DD
project: [project-name or "general"]
tags: [tag1, tag2, tag3]
---

# [Title]

## Context
[When does this apply, what situation triggered it, why it matters]

## Problem / Goal
[What was wrong or what needed to be achieved]

## Solution Comparison (optional)
| Approach | Pros | Cons | Chosen? |
|----------|------|------|---------|
| A | ... | ... | No |
| B | ... | ... | Yes |

## Implementation
```bash
# Commands here, copy-paste ready
```

## Verification
[How to confirm success]

## Recovery
[How to undo if needed]

## Key Lessons
[What to remember for next time]

## Related
- [Other doc](../path/to/doc.md)
```

## Cheat Sheet Template

```markdown
# [Topic] Quick Reference

## Standard Workflow
1. Step one
2. Step two
3. Step three

## Common Commands
```bash
# Most common
command --option

# With flags
command --verbose --output=file
```

## Checklist
- [ ] Item 1
- [ ] Item 2

## Common Errors
| Error | Fix |
|-------|-----|
| ... | ... |

## Recovery
```bash
# How to undo
```
```
