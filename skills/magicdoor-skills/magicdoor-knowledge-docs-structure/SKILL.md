---
name: magicdoor-knowledge-docs-structure
description: Use when initializing or reorganizing project documentation to follow a standard .knowledge/ structure, migrating from .cursor/docs/ or root-level docs/, or when AGENTS.md contains concrete specs that should be moved to dedicated docs
---

# Knowledge Project Doc Structure

## Overview

Standardize project documentation into a `.knowledge/` structure with committed specs, ignored scratch notes, and a minimal AGENTS.md that only references the entry point.

## When to Use

- Project lacks a unified documentation entry point or index
- AGENTS.md contains concrete specs, architecture details, or code style rules
- Existing docs live in `.cursor/docs/`, root `docs/`, or other non-standard locations and need migration
- Setting up documentation for a new project (greenfield)

Do not use for:
- Pure tool references or one-off temporary documentation
- Documentation that does not need to be committed or shared

## Core Pattern

| Before | After |
|--------|-------|
| AGENTS.md contains concrete specs, architecture, and code style rules | AGENTS.md is minimal — only doc conventions, referencing only `entry.md` |
| Documentation scattered across `.cursor/docs/`, root `docs/`, or other locations | All docs centralized in `.knowledge/docs/` |
| No unified index or entry point for documentation | `entry.md` serves as the single entry point |
| No separation between committed specs and scratch notes | `docs/` is committed, `notes/` is gitignored |

## Standard Structure

```
.knowledge/
├── docs/                   # Committed documentation
│   ├── entry.md           # Single entry point (index)
│   ├── general-development-guidelines.md  # Core spec
│   └── ...                # Other topic/feature docs
└── notes/                 # Scratch notes (gitignored)
    └── (developer scratch docs, not committed)

AGENTS.md                  # Project root, references only entry.md
.gitignore                 # Must ignore .knowledge/notes/
```

## Rules

1. **All docs live in `.knowledge/docs/`** — No other locations
2. **docs/ is committed, notes/ is ignored** — Clear separation
3. **Single entry: `entry.md`** — The only doc AGENTS.md may reference
4. **AGENTS.md minimal** — Only doc conventions, no concrete specs

## Implementation

### Step 0: Probe Current State

Check if standard structure exists:

```bash
# Check directories
ls -la .knowledge/docs/ 2>/dev/null && echo "docs exists" || echo "docs missing"
ls -la .knowledge/notes/ 2>/dev/null && echo "notes exists" || echo "notes missing"

# Check entry.md
ls .knowledge/docs/entry.md 2>/dev/null && echo "entry.md exists" || echo "entry.md missing"

# Check gitignore
grep -q "\.knowledge/notes" .gitignore 2>/dev/null && echo "notes ignored" || echo "notes NOT ignored"
```

Identify existing docs in other locations (`.cursor/docs/`, `docs/`, etc.) that need migration.

### Step 1: Create .knowledge/ Structure

**If `.knowledge/` doesn't exist:**

```bash
mkdir -p .knowledge/docs .knowledge/notes
```

**Create `entry.md` if missing:**

```markdown
# Project documentation entry

Project doc entry is this file. All specs and topic docs live under `.knowledge/docs/`. Read this index then open the relevant doc.

## Core spec

- [General Development Guidelines](general-development-guidelines.md) – Technology stack, structure, workflow, code quality, doc organization.

## Specialized guidelines

<!-- Add links to specialized docs as needed -->

## Feature / domain docs

<!-- Add links to feature docs as needed -->
```

**Create `general-development-guidelines.md` if missing:**

```markdown
# General Development Guidelines

This is the authoritative project dev spec and architecture.

## Technology Stack

<!-- Fill in: framework, language, build tool, etc. -->

## Project Structure

<!-- Fill in: directory organization -->

## Code Conventions

<!-- Fill in: naming, imports, exports, etc. -->

## Build / Test Commands

<!-- Fill in: npm run build, test, lint, etc. -->
```

### Step 2: Configure .gitignore

**Ensure `.knowledge/notes/` is ignored:**

```bash
# Add to .gitignore if not present
cat >> .gitignore << 'EOF'

# Developer scratch docs (do not commit)
.knowledge/notes/
.knowledge/debug-*.log
EOF
```

### Step 3: Migrate Existing Docs

**If docs exist in other locations:**

1. **Move from `.cursor/docs/`:**

   ```bash
   mv .cursor/docs/* .knowledge/docs/ 2>/dev/null || true
   rmdir .cursor/docs 2>/dev/null || true
   ```

2. **Move from `docs/` (project root):**

   ```bash
   mv docs/* .knowledge/docs/ 2>/dev/null || true
   rmdir docs 2>/dev/null || true
   ```

3. **Update all internal links** in moved docs (replace old paths with new `.knowledge/docs/` paths)

### Step 4: Create/Update AGENTS.md

**AGENTS.md must be minimal — only doc conventions:**

```markdown
# AGENTS.md - Coding Guidelines for AI Agents

> **Full project documentation**: See [`.knowledge/docs/entry.md`](.knowledge/docs/entry.md)

## Doc Organization

- **Project docs**: `.knowledge/docs/` — committed specs and guidelines
- **Entry point**: `.knowledge/docs/entry.md` — start here for all documentation
- **Scratch notes**: `.knowledge/notes/` — developer scratch docs, not committed

When you need project spec or feature docs, read the entry doc first for the index,
then open the relevant doc. The scratch directory is optional reference only.
```

**Remove from AGENTS.md:**

- ❌ Concrete specs (do-nots, architecture, code style)
- ❌ Direct links to specific docs (only entry.md is allowed)
- ❌ Build commands, tech stack details
- ❌ Naming conventions, import rules

**Keep in AGENTS.md:**

- ✅ Doc directory locations
- ✅ Reference to entry.md only
- ✅ Agent workflow instruction

### Step 5: Update References

**Update README.md in project root:**

```markdown
## Full Documentation

See [`.knowledge/docs/entry.md`](.knowledge/docs/entry.md) for complete development guidelines.
```

**Search and replace old references:**

```bash
# Find references to old doc locations
grep -r "\.cursor/docs" . --include="*.md" 2>/dev/null || true
grep -r "^docs/" . --include="*.md" 2>/dev/null | grep -v ".knowledge" || true

# Update to new location
# (Manual review recommended for each match)
```

### Step 6: Verify Structure

```bash
# Verify structure
echo "=== Checking .knowledge structure ==="
tree .knowledge/ 2>/dev/null || find .knowledge -type f | head -20

echo "=== Checking .gitignore ==="
grep "knowledge" .gitignore || echo "WARNING: .knowledge not in .gitignore"

echo "=== Checking AGENTS.md references ==="
grep -o '\[.*\](.*\.md)' AGENTS.md | grep -v entry.md && echo "WARNING: AGENTS.md references non-entry docs" || echo "OK: AGENTS.md only references entry.md"
```

## Common Mistakes

- **AGENTS.md contains concrete specs** — Move all concrete specs to `.knowledge/docs/`. AGENTS.md should only contain doc conventions and reference `entry.md`.
- **Forgetting to gitignore `.knowledge/notes/`** — Always ensure `.knowledge/notes/` is in `.gitignore` to prevent scratch docs from being committed.
- **Linking non-entry docs from AGENTS.md** — AGENTS.md must only reference `.knowledge/docs/entry.md`. All other docs should be linked from `entry.md`.
- **Leaving docs in old locations** — After migration, verify old directories (`.cursor/docs/`, root `docs/`) are empty or removed to prevent confusion.

## Common Scenarios

### Scenario A: Greenfield (No Docs Exist)

1. Create `.knowledge/docs/` and `.knowledge/notes/`
2. Create `entry.md` and `general-development-guidelines.md` with templates
3. Create minimal `AGENTS.md`
4. Add `.knowledge/notes/` to `.gitignore`
5. Commit the structure

### Scenario B: Has `.cursor/docs/` (Migrate)

1. Create `.knowledge/` structure
2. Move all docs from `.cursor/docs/` to `.knowledge/docs/`
3. Rename `README.md` to `entry.md` if that's the index
4. Update AGENTS.md to reference only entry.md
5. Remove concrete specs from AGENTS.md
6. Update `.gitignore` to ignore `.knowledge/notes/`
7. Clean up empty `.cursor/` directory if desired

### Scenario C: Has `docs/` in Project Root (Migrate)

1. Create `.knowledge/` structure
2. Move all docs from `docs/` to `.knowledge/docs/`
3. Follow remaining steps from Scenario B

### Scenario D: AGENTS.md Has Too Much Content (Restructure)

1. Move all concrete specs from AGENTS.md to `.knowledge/docs/general-development-guidelines.md`
2. Rewrite AGENTS.md to only reference entry.md
3. Update entry.md to include link to the new core spec doc

## Checklist

After implementation, verify:

- [ ] `.knowledge/docs/` exists and contains docs
- [ ] `.knowledge/docs/entry.md` exists
- [ ] `.knowledge/notes/` exists (can be empty)
- [ ] `.gitignore` ignores `.knowledge/notes/`
- [ ] `AGENTS.md` only references `.knowledge/docs/entry.md`
- [ ] `AGENTS.md` has no concrete specs (only doc conventions)
- [ ] All old doc locations are empty or removed
- [ ] Project root README.md references entry.md
