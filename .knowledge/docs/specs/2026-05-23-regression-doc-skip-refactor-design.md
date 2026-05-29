# Regression Doc Skip & Skill Refactor Design

Date: 2026-05-23
Status: Approved Design

## Problem

The `magicdoor-pr-regression-handoff` skill always generates a regression doc when creating or updating PRs. Users need the ability to skip this step. Additionally, the skill has two areas needing improvement:

1. Pre-push checks assume Node.js (hardcoded `npm` scripts), but the skill is used across projects
2. PR template handling is weak — should enforce using an existing template when available

## Changes

### 1. Add `--skip-regression-doc` flag

- New argument: `--skip-regression-doc` (default: false)
- When true, skip Step 3 (Create/Update Regression Doc) and Step 4 (Commit) in both create-pr and update-pr flows
- When false, behavior is identical to current

### 2. Lightweight docs path detection

Current Step 2 ("Detect Docs Architecture") probes multiple paths (`.knowledge/docs/`, `docs/`, `.github/docs/`, etc.) with fallback logic. Replace with a lightweight detection:

- Probe `.knowledge/docs/` first (per `magicdoor-knowledge-docs-structure` convention)
- If absent, probe legacy paths (`docs/`, `.github/docs/`) for existing regression docs
- If none exist, create under `.knowledge/docs/`
- Do NOT invoke the `magicdoor-knowledge-docs-structure` skill — it is for initialization/migration, not runtime path detection; calling it would trigger doc migration, AGENTS.md rewrite, and .gitignore modification

### 3. Flexible pre-push checks

Extract pre-push logic into `workflows/pre-push.md` that auto-detects project type:

| Project File | Detection | Checker |
|-------------|-----------|---------|
| `package.json` | Exists | Check script existence before executing: `format` → `lint` → `type-check`. Skip missing scripts with warning. |
| `go.mod` | Exists | `go fmt ./...` → `go vet ./...` |
| `Cargo.toml` | Exists | `cargo fmt --check` → `cargo check` |
| `pyproject.toml` | Exists | Probe available tools: `ruff check .` → `black --check .` → `mypy .`. Skip missing tools. |
| `Makefile` | Exists | `make -n <target> 2>/dev/null` to probe; execute `format` → `lint` → `check` in order. Skip missing targets. |
| None found | — | Warn and proceed (no checks available) |

### 4. PR template enforcement

**Create PR**: If a PR template exists (`.github/pull_request_template.md`, `docs/PR_TEMPLATE.md`, `.github/PULL_REQUEST_TEMPLATE.md`), use it as the PR body base. Append generated summary, test notes, metadata, and regression doc link after template content.

**Update PR**: Preserve existing PR body entirely. Append recent changes section at the end. Do NOT re-apply template — user may have modified template content since creation.

### 1a. `--skip-regression-doc` behavior

Edge case definitions:

| Scenario | Behavior |
|----------|----------|
| Create PR with `--skip-regression-doc` | PR body includes inline test notes and summary. No separate regression doc file is created. |
| Update PR with `--skip-regression-doc`, doc exists | Skip doc update. Preserve existing doc link in PR body. Append new changes only. |
| Update PR with `--skip-regression-doc`, no doc exists | Same as Create PR with skip — append test notes inline, no doc created. |
| `--skip-regression-doc` not set | Full flow: create/update regression doc and link in PR body (current behavior). |

## Architecture

```
magicdoor-pr-regression-handoff/
├── SKILL.md               # GSD XML: mode dispatch + argument parsing
├── workflows/
│   ├── create-pr.md       # Create PR steps (regression doc is conditional)
│   ├── update-pr.md       # Update PR steps (regression doc is conditional)
│   └── pre-push.md        # Project-type auto-detection + checker execution
```

### SKILL.md

GSD-style with `<objective>`, `<execution_context>`, `<context>`, `<process>`, `<critical_rules>`, `<success_criteria>`.

Arguments: `[--mode create-pr | update-pr] [--skip-regression-doc]`

### create-pr.md Flow

1. **Analyze Changes** — `git log/stat/name-only origin/master..HEAD`
2. **Resolve Docs Path** — lightweight detection: `.knowledge/docs/` → legacy paths → create `.knowledge/docs/`
3. **[conditional] Create Regression Doc** — skip if `--skip-regression-doc`
4. **[conditional] Commit Regression Doc** — skip if `--skip-regression-doc`
5. **Pre-push Checks** — invoke `@pre-push.md`
6. **Push Branch**
7. **Create PR** — if PR template exists, use as base then append generated content. Regression doc link only if doc was created.
8. **Verify**

### update-pr.md Flow

1. **Analyze New Changes** — `git log/stat/name-only origin/{branch}..HEAD`
2. **Resolve Docs Path** — same as create-pr
3. **[conditional] Update Regression Doc** — skip if `--skip-regression-doc`
4. **[conditional] Commit Regression Doc Update** — skip if `--skip-regression-doc`
5. **Pre-push Checks** — invoke `@pre-push.md`
6. **Push Branch**
7. **Update PR Body** — preserve existing body entirely. Append recent changes. Do NOT re-apply template. Regression doc link preserved or updated as needed.
8. **Verify**

## Open/Closed

### In Scope
- GSD XML restyle of SKILL.md
- `--skip-regression-doc` flag and conditional step routing
- Pre-push auto-detection by project type
- PR template enforcement
- Update-pr flow aligned

### Out of Scope (this iteration)
- Custom checker command configuration
- Docker-based project detection
- Regression doc content format changes
