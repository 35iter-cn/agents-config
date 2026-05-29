# Write Workflow

**Purpose:** Document new knowledge into the AI-taught-me repository.

## Steps

### Step 1: Determine Category and Topic

Based on the content being documented, choose:
- **Category:** High-level grouping (`git-workflow`, `debugging`, `tools`, `architecture`, `rush-monorepo`, etc.)
- **Topic:** Specific descriptive name (use kebab-case, e.g., `rebase-cleanup`, `merge-conflict-resolution`)

If unsure, ask user to confirm before creating directories.

### Step 2: Create Directory

```bash
mkdir -p /root/code/AI-taught-me/{category}/{topic}/
```

### Step 3: Write Full Report (`report.md`)

Use the template from `@./common.md`. Include:
- **Date** in frontmatter
- **Context** — what project, what situation triggered this
- **Complete commands** — copy-paste ready, with expected output
- **Verification steps** — how to confirm it worked
- **Recovery method** — how to undo if needed
- **Key lessons** — what to remember for next time

### Step 4: Extract Cheat Sheet (`cheat-sheet.md`)

From the report, pull out:
- Quick command reference (no narrative)
- Essential checklists
- Common error fixes
- Recovery commands

### Step 5: Verify Both Files

- [ ] `report.md` has full context and narrative
- [ ] `cheat-sheet.md` has commands only, no story
- [ ] Both files include searchable keywords (see `@./common.md`)
- [ ] Date is present in report frontmatter
- [ ] Recovery/undo method is documented

### Step 6: Commit and Push (MANDATORY)

**This step is NOT optional. Do NOT ask user for permission.**

```bash
cd /root/code/AI-taught-me
git add .
git commit -m "Add {topic} guide"
git push origin master
```

- Do NOT leave documents uncommitted
- Do NOT ask user for permission to commit/push

## Quality Checklist

Before finishing:

- [ ] Directory follows `category/topic/` two-level structure
- [ ] `report.md` has full context and narrative
- [ ] `cheat-sheet.md` has commands only, no story
- [ ] Both files include searchable keywords
- [ ] Date is present
- [ ] Recovery/undo method is documented
- [ ] Files committed and pushed to AI-taught-me repo

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Only writing narrative | Always include cheat sheet |
| Missing date/context | Add frontmatter with date |
| Too project-specific | Extract generalizable patterns |
| No verification steps | Add "how to confirm it worked" |
| No recovery method | Add "how to undo" section |
| Not committing | Step 6 is MANDATORY |
