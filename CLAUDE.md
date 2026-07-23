# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal AI agent configuration repository (`agents-for-myself`). It manages canonical agent instructions and Claude Code skills across multiple AI coding tools.

## Repository Structure

```
agents-for-myself/
├── instructions/       # Canonical agent instructions
├── scripts/            # Sync and maintenance scripts
├── skills/             # Canonical skill tree (single source of truth)
│   ├── magicdoor-skills/   # MagicDoor-specific skills
│   └── ...                 # General skills
└── .knowledge/         # Project knowledge (plans, specs)
    ├── plans/
    └── notes/specs/
```

## Skill Structure

Every skill directory follows this layout:

```
skill-name/
├── SKILL.md        # Required: frontmatter + markdown body
├── references/     # Optional: supplementary docs
├── workflows/      # Optional: step scripts
├── cases/          # Optional: test cases
└── shared/         # Optional: shared references
```

SKILL.md must include frontmatter with `name` and `description`, and a clear workflow body.

## Available Skills

- **`skills/`** — General skills: frontend-design, karpathy-guidelines, mermaid-diagrams, productivity (grill-me, handoff)
- **`skills/magicdoor-skills/`** — MagicDoor-specific: backend API, PR workflows, Rush monorepo, rebase, work summary, etc.

Each skill directory contains `SKILL.md` with full documentation.

## Key Commands

```bash
scripts/sync-skills.mjs -h                      # Sync skills to target dirs
scripts/maintain-instructions-symlinks.mjs -h   # Maintain instruction symlinks
```

## Key Conventions

- **Skill naming:** kebab-case, prefixed with `magicdoor-` for MagicDoor-specific skills
- **English only:** All SKILL.md files must be written entirely in English
- **Sync skills on change:** After adding or removing a skill, run `scripts/sync-skills.mjs`
- **Knowledge docs:** Design specs go in `.knowledge/notes/specs/`
- **No build system:** Pure Markdown with occasional scripts — no package.json, no CI
- **Bash scripts:** Use `set -euo pipefail`, consistent CLI conventions (`--dry-run`, `--help`)

## Architecture Decisions

### Instructions Management

- The canonical instruction file lives at `instructions/default.md`
- Symlinked to multiple AI tool config paths via `scripts/maintain-instructions-symlinks.mjs` using the manifest at `scripts/instructions-symlinks.paths`
- Multiple instruction stems can coexist in `instructions/`; select via `-c <stem>`
- No symlink is created at the repo root (Cursor root `AGENTS.md` is out of scope)

### Skills Sync Architecture

- Skills are organized hierarchically in `skills/` but flattened into each target directory via symlinks
- `skills/` is the **single source of truth** for Codex and Claude Code skill sources
- Targets are declared in `scripts/skills-symlinks.targets` (currently `~/.claude/skills` and `~/.codex/skills`)
