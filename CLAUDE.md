# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal AI agent configuration repository (`agents-for-myself`). It manages canonical agent instructions and Claude Code skills across multiple AI coding tools.

Skills are organized in two categories:
- **General skills** (`skills/`): frontend-design, karpathy-guidelines, mermaid-diagrams, productivity
- **MagicDoor skills** (`skills/magicdoor-skills/`): backend API integration, PR workflows, Rush monorepo, rebase, work summary, etc.

## Repository Structure

```
agents-for-myself/
├── instructions/default.md       # Canonical agent instructions (symlinked to ~/.claude/CLAUDE.md, ~/.copilot/instructions.md, etc.)
├── bin/
│   ├── sync-skills                # Sync leaf skill dirs into ~/.claude/skills and ~/.codex/skills as flat symlinks
│   ├── maintain-instructions-symlinks  # Maintain symlinks from manifest to instructions/<stem>.md
│   └── instructions-symlinks.paths     # Manifest of managed symlink paths
├── skills/                       # Canonical skill tree (single source of truth for Claude Code skills)
│   ├── magicdoor-skills/         # MagicDoor-specific skills
│   ├── mermaid-diagrams/
│   ├── karpathy-guidelines/
│   ├── frontend-design/
│   └── productivity/
│       ├── grill-me/
│       └── handoff/
└── .knowledge/                   # Project knowledge (plans, specs)
    ├── plans/
    └── notes/specs/
```

## Skill Structure

Every skill directory follows this layout:

```
skill-name/
├── SKILL.md              # Required: frontmatter + markdown body
├── references/           # Optional: supplementary docs
├── workflows/            # Optional: step scripts referenced by SKILL.md
├── cases/                # Optional: test cases
└── shared/               # Optional: shared references
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

Some skills have `workflows/` containing modular step-by-step scripts sourced or referenced from `SKILL.md`.

## Available Skills

### General Skills

| Directory | Purpose |
|---|---|
| `frontend-design/` | Build distinctive, production-grade frontend interfaces with high design quality |
| `karpathy-guidelines/` | Behavioral guidelines to reduce common LLM coding mistakes |
| `mermaid-diagrams/` | Comprehensive guide for creating software diagrams using Mermaid syntax |
| `productivity/grill-me/` | Interview the user relentlessly about plans until shared understanding |
| `productivity/handoff/` | Compact conversation into a handoff document for another agent |

### MagicDoor Skills

| Directory | Purpose |
|---|---|
| `magicdoor-backend-specs/` | Download OpenAPI specs, query API schemas, regenerate TypeScript types |
| `magicdoor-backend-use/` | Direct backend API behavior verification via HTTP calls |
| `magicdoor-backend-issuer/` | Autonomous backend bug investigation & issue filing |
| `magicdoor-pr-regression-handoff/` | Create/update PRs with regression test docs for QA handoff |
| `magicdoor-pr-uat-cases/` | Generate UAT test cases from PR diff |
| `magicdoor-knowledge-docs-structure/` | Standardize `.knowledge/` documentation structure |
| `resolving-rebase-conflicts/` | Rebase conflict resolution workflows |
| `rush-monorepo/` | Rush monorepo dependency/build/test workflows |
| `working-with-solid-use-case/` | SolidJS use-case architecture (gateway, presenter, AppState) |
| `work-summary/` | Generate personal work summaries from git commits |
| `ai-taught-me/` | Read/write AI-taught-me knowledge repository |

## Key Commands

### Sync skills to Claude Code

```bash
bin/sync-skills -h
```

Syncs leaf skill directories containing `SKILL.md` into target dirs as flat symlinks.

**Environment variables (override defaults):**

| Variable | Meaning |
|---|---|
| `SKILLS_CANONICAL_ROOT` | Canonical scan root (same as `-s`) |
| `SKILLS_SYMLINKS_TARGETS` | Override targets file path |

**Linking rules:** Only leaf directories containing `SKILL.md` are linked; category folders (no `SKILL.md` at that level) expose only their direct children. Duplicate link names exit with code 3. Existing non-symlink entries at a managed name exit with code 4. By default, `link` also removes stale managed symlinks whose names are no longer in the scan (use `--no-prune` to skip). Unrelated names under target directories are never removed.

**Sandbox test (before first production run):**

```bash
rm -rf /tmp/skills-sync-test-src /tmp/skills-sync-test-claude
mkdir -p /tmp/skills-sync-test-src/alpha
echo '# test' > /tmp/skills-sync-test-src/alpha/SKILL.md
mkdir -p /tmp/skills-sync-test-src/cat-beta/gamma /tmp/skills-sync-test-src/cat-beta/delta
echo '# g' > /tmp/skills-sync-test-src/cat-beta/gamma/SKILL.md
echo '# d' > /tmp/skills-sync-test-src/cat-beta/delta/SKILL.md
"bin/sync-skills" -s /tmp/skills-sync-test-src --dry-run
"bin/sync-skills" -s /tmp/skills-sync-test-src
```

**Backup `~/.agents/skills` (recommended before first real sync):**

```bash
mkdir -p backups
ts="$(date +%Y%m%d-%H%M%S)"
tar -czf "backups/agents-skills-${ts}.tar.gz" -C "$HOME" .agents/skills
```

Restore: `tar -xzf backups/agents-skills-*.tar.gz -C "$HOME"`.

### Maintain instruction symlinks

```bash
bin/maintain-instructions-symlinks -h
```

Symlinks the canonical instruction from `instructions/<stem>.md` to paths listed in `bin/instructions-symlinks.paths`.

**Safety:** `unlink` only removes symlinks whose target resolves within this repo. Non-symlink files are warned and skipped. Broken symlinks are not removed.

## Key Conventions

- **Skill naming:** kebab-case, prefixed with `magicdoor-` for MagicDoor-specific skills
- **English only:** All SKILL.md content must be written entirely in English
- **Knowledge docs:** Design specs go in `.knowledge/docs/specs/`
- **No build system:** This repo is pure Markdown with occasional shell scripts — no package.json, no tests, no CI
- **Bash scripts:** Use `set -euo pipefail` and follow consistent CLI conventions (short options, `--dry-run`, `--help`)

## Architecture Decisions

### Instructions Management

- The canonical instruction file lives at `instructions/default.md` (moved from `~/.agents/AGENTS.md`).
- It is symlinked to multiple AI tool config paths via `bin/maintain-instructions-symlinks` using the manifest at `bin/instructions-symlinks.paths`.
- Multiple instruction stems can coexist in `instructions/`; select via `-c <stem>`.
- No symlink is created at the repo root (Cursor root `AGENTS.md` is out of scope).

### Skills Sync Architecture

- Skills are organized hierarchically in `skills/` but flattened into each target directory via symlinks.
- `skills/` is the **single source of truth** for Codex and Claude Code skill sources.
- Targets are declared in `bin/skills-symlinks.targets` (currently `~/.claude/skills` and `~/.codex/skills`).

### Knowledge Documents

- Plans and specs live under `.knowledge/`, following the user's preferred paths:
  - `brainstorming` specs: `.knowledge/docs/specs/`
  - `writing-plans` plans: `.knowledge/notes/plans/`

## Agent Preferences

- **All responses must be in Chinese.**
- **Git worktree directory:** `~/.config/worktrees`
