# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal AI agent configuration repository (`agents-for-myself`). It manages canonical agent instructions and Claude Code skills across multiple AI coding tools.

## Repository Structure

```
agents-for-myself/
├── instructions/       # Canonical agent instructions
├── scripts/            # Sync and maintenance scripts
├── cli/                # User CLI scripts (synced to ~/.local/bin)
├── skills/             # Canonical skill tree (single source of truth)
│   ├── browser-automation/
│   ├── companions/
│   ├── magicdoor/
│   ├── private/            # Local-only skills (gitignored)
│   ├── tools/
│   └── workflow/
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

- **`skills/browser-automation/`** — Chrome automation (timesheet, Xiaohongshu)
- **`skills/companions/`** — Companion runners (`runx`, `tune`)
- **`skills/magicdoor/`** — MagicDoor-specific: backend API, portal login, Rush, solid-use-case, work summary
- **`skills/workflow/`** — Spec shipping, PR handoff/UAT, grilling, handoff, ai-taught-me
- **`skills/tools/`** — chrome-debug, frontend-design, update-claude
- **`skills/private/`** — Personal / sensitive skills. **Gitignored** (`skills/private/` in `.gitignore`). Never commit this directory. Sync locally with `scripts/sync-skills.mjs` like other skills.

Each skill directory contains `SKILL.md` with full documentation.

## Key Commands

```bash
scripts/sync-skills.mjs -h                      # Sync skills to target dirs
scripts/sync-cli.mjs -h                         # Sync cli/ scripts to ~/.local/bin
scripts/maintain-instructions-symlinks.mjs -h   # Maintain instruction symlinks
session-path -h                                 # Resolve ~/.config/sessions/<repo>/<type>
```

## Key Conventions

- **Skill naming:** kebab-case, prefixed with `magicdoor-` for MagicDoor-specific skills
- **English only:** All SKILL.md files must be written entirely in English
- **Sync skills on change:** After adding or removing a skill, run `scripts/sync-skills.mjs`
- **Sync CLI on change:** After adding or removing a file under `cli/`, run `scripts/sync-cli.mjs`
- **Private skills:** Put personal/sensitive skills under `skills/private/` (gitignored). Do not commit them.
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
- `skills/` is the **single source of truth** for Claude Code skill sources (other tools that read `~/.claude/skills` share this tree)
- Targets are declared in `scripts/skills-symlinks.targets` (currently `~/.claude/skills`)

### CLI Sync Architecture

- User-facing command scripts live in `cli/` (source basename === PATH command name)
- `scripts/sync-cli.mjs` flattens them into targets declared in `scripts/cli-symlinks.targets` (currently `~/.local/bin`)
