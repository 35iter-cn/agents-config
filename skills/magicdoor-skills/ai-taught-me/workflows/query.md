# Query Workflow

**Purpose:** Retrieve and present existing knowledge from the AI-taught-me repository.

## Steps

### Step 1: Extract Keywords from User Query

Parse the user's query for search terms:
- Technology names (git, docker, typescript...)
- Actions (rebase, debug, deploy...)
- Symptoms (conflict, error, slow...)
- Tool names (rush, eslint, vite...)

### Step 2: Search the Repository

Run searches in priority order:

**Priority 1: Directory name match (highest weight)**
```bash
find /root/code/AI-taught-me -type d -name "*{keyword}*"
```

**Priority 2: File content search**
```bash
grep -r "{keyword}" /root/code/AI-taught-me --include="*.md" -l
```

**Priority 3: Related category browsing**
```bash
ls /root/code/AI-taught-me/
```

### Step 3: Rank and Select Results

Apply this ranking:
1. **Exact directory name match** — highest confidence
2. **Partial directory name match** — medium confidence
3. **Content keyword match** — supplementary
4. **Category-level match** — fallback browse

### Step 4: Present Results Based on Match Count

**Single precise match:**
→ Proceed directly to Step 5 (present the content)

**Multiple matches (2-10):**
→ List Top 3 candidates with paths, ask user to choose:
```
Found multiple matches:
1. git-workflow/rebase-cleanup/ (directory name match)
2. git-workflow/merge-conflict/ (content match: "rebase")
3. tools/git-aliases/ (content match: "rebase")

Which one? (1/2/3 or describe more)
```

**No matches:**
→ Inform user, offer to browse:
```
No matches found for "{query}".
Available categories: [list from ls]
Would you like to browse a specific category?
```

### Step 5: Determine Which File to Present

**User wants quick lookup** (keywords: "快速", "命令", "怎么做", "quick", "command", "how to"):
→ Read and present `cheat-sheet.md`

**User wants full background** (keywords: "背景", "为什么", "原因", "background", "why", "context"):
→ Read and present `report.md`

**Intent unclear (default):**
→ Read and present `cheat-sheet.md`, then offer:
```
This is the quick reference. Want the full case study report too? (yes/no)
```

### Step 6: Present Content

- Display the file content clearly
- Highlight the most relevant sections based on the query
- If the document has `Related:` links, mention them:
  ```
  Related documents found: [list links]
  Want me to fetch any of these? (yes/no)
  ```

## Decision Tree

```
User query
    ↓
Extract keywords
    ↓
Search by directory name → Exact match? → Yes → Present cheat-sheet.md
                                        → No  ↓
Search by content      → Matches found? → Yes (1) → Present cheat-sheet.md
                                        → Yes (2+) → List top 3, ask user
                                        → No       → Inform, offer to browse
```
