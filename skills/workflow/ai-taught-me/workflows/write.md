# Write Workflow

`REPO=~/code/AI-taught-me` (shared rules: see SKILL.md).

## Steps

1. `ls "$REPO"` → pick `<category>/<topic>` (kebab-case, reuse an existing category when one fits — never ask the user)
2. `mkdir -p "$REPO/<category>/<topic>"`
3. Write `report.md` from the template below — full narrative with context, commands, verification, recovery, lessons. Include searchable keywords (technologies, actions, symptoms, tools) and `date` in frontmatter.
4. Write `cheat-sheet.md` — commands and checklists only, no narrative.
5. Commit and push — **mandatory, do not ask permission**:
   ```bash
   cd "$REPO" && git add . && git commit -m "Add <topic> guide" && git push origin master
   ```
6. In your summary, state where the doc landed (e.g. `git-workflow/rebase-cleanup/`) so the user can correct the placement.

## report.md Template

````markdown
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
````

## cheat-sheet.md Template

````markdown
# [Topic] Quick Reference

## Standard Workflow
1. Step one
2. Step two

## Common Commands
```bash
command --option
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
````
