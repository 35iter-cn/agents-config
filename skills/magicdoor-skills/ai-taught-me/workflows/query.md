# Query Workflow

`REPO=~/code/AI-taught-me` (shared rules: see SKILL.md).

## Steps

1. Extract keywords from the query (technologies, actions, symptoms, tools).
2. Search, in order:
   ```bash
   find "$REPO" -type d -name "*<keyword>*"
   grep -rl "<keyword>" "$REPO" --include="*.md"
   ```
3. Present by match count:
   - **1 match** → show its `cheat-sheet.md`, then offer the full `report.md`
   - **2–10 matches** → list top 3 candidates with paths, ask the user to pick
   - **0 matches** → `ls "$REPO"`, list available categories, offer to browse
4. Intent "背景/为什么/why/context" → show `report.md` instead of the cheat sheet.
5. If the doc has `Related:` links, mention them and offer to fetch.
