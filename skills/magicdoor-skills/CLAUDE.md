# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the MagicDoor skills subtree — a collection of AI coding assistant skills for MagicDoor frontend development. Each skill is a self-contained directory with a `SKILL.md` that teaches an AI agent how to handle specific technologies and workflows.

## Skill Structure

Every skill directory follows this layout:

```
skill-name/
├── SKILL.md              # Required: frontmatter + markdown body
├── references/           # Optional: supplementary docs
├── workflows/            # Optional: step scripts referenced by SKILL.md
├── cases/                # Optional: test cases (magicdoor-backend-use)
└── shared/               # Optional: shared references (magicdoor-backend-use)
```

### SKILL.md Frontmatter

```yaml
---
name: kebab-case-name
description: |
  When to use this skill. Include specific triggers.
category: framework|tool|workflow|development
date_added: "2026-03-21"
---
```

### Workflows

Some skills have `workflows/` containing modular, step-by-step scripts (e.g., `execute-test-plan.md`, `create-pr.md`). These are sourced or referenced from `SKILL.md`.

## Available Skills

| Directory | Purpose |
|-----------|---------|
| `magicdoor-backend-specs/` | Download OpenAPI specs, query API schemas, regenerate TypeScript types |
| `magicdoor-backend-use/` | Direct backend API behavior verification via HTTP calls |
| `magicdoor-backend-issuer/` | Autonomous backend bug investigation & issue filing |
| `magicdoor-pr-regression-handoff/` | Create/update PRs with regression test docs for QA handoff |
| `magicdoor-knowledge-docs-structure/` | Standardize `.knowledge/` documentation structure |
| `rush-monorepo/` | Rush monorepo dependency/build/test workflows |
| `working-with-solid-use-case/` | SolidJS use-case architecture (gateway, presenter, AppState) |
| `work-summary/` | Generate personal work summaries from git commits |
| `ai-taught-me/` | Read/write AI-taught-me knowledge repository |

## Key Conventions

- **Skill naming:** kebab-case, prefixed with `magicdoor-` for MagicDoor-specific skills
- **English only:** All skill content (SKILL.md, workflows, references, cases) must be written entirely in English — no Chinese or other languages in skill bodies or code blocks
- **Workflow sourcing:** Workflow files are sourced from `SKILL.md` context, not executed as standalone scripts
- **Knowledge docs:** Design specs go in `.knowledge/docs/specs/`
- **No build system:** This repo is pure Markdown with occasional shell scripts — no package.json, no tests, no CI
- **`.gitignore`:** `node_modules`, `coverage`, `plans` directories are ignored
