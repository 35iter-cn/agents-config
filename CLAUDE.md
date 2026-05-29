# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal AI agent configuration repository (`agents-for-myself`). It manages canonical agent instructions and Claude Code skills across multiple AI coding tools.

## Repository Structure

```
agents-for-myself/
├── instructions/default.md       # Canonical agent instructions (symlinked to ~/.claude/CLAUDE.md, ~/.copilot/instructions.md, etc.)
├── bin/
│   ├── sync-skills                # Sync leaf skill dirs into ~/.claude/skills and ~/.codex/skills as flat symlinks
│   ├── maintain-instructions-symlinks  # Maintain symlinks from manifest to instructions/<stem>.md
│   └── instructions-symlinks.paths     # Manifest of managed symlink paths
├── skills/                       # Canonical skill tree (single source of truth for Claude Code skills)
│   ├── README.md
│   ├── magicdoor-skills/         # MagicDoor-specific skills (submodule or copied tree)
│   ├── mermaid-diagrams/
│   ├── karpathy-guidelines/
│   └── frontend-design/
└── .knowledge/                   # Project knowledge (plans, specs)
    ├── plans/
    └── notes/specs/
```

## Key Commands

### Sync skills to Claude Code

`bin/sync-skills -h`：

```
Usage: sync-skills [link|unlink] [options]

Commands:
  link    Create/update symlinks and prune stale managed links (default)
  unlink  Remove symlinks under target dirs that point into the canonical tree

Options:
  -s, --source PATH     Canonical skills root (default: ~/agents-for-myself/skills)
  --no-prune            With link: do not remove stale managed symlinks
  --dry-run             Print actions only
  -h, --help            Show this help

Env: SKILLS_CANONICAL_ROOT, SKILLS_SYMLINKS_TARGETS
```

```bash
bin/sync-skills
bin/sync-skills link
bin/sync-skills --dry-run
bin/sync-skills -s /path/to/skills
bin/sync-skills link --no-prune
bin/sync-skills unlink

**Behavior:** Only leaf directories containing `SKILL.md` are linked. Category folders (no `SKILL.md`) expose only their direct children. Duplicate link names exit with code 3. Existing non-symlink entries exit with code 4. By default, `link` also removes direct entries under the target that are symlinks into the canonical tree whose names are no longer present in the scan (use `--no-prune` to skip). `unlink` removes symlinks under the target that resolve into the canonical tree; it skips non-symlinks, broken symlinks, and targets outside the canonical tree (with warnings where applicable).

### Maintain instruction symlinks

`bin/maintain-instructions-symlinks -h`：

```
Usage: maintain-instructions-symlinks [link|unlink] [options]
Commands:
  link    Create/update symlinks (default)
  unlink  Remove symlinks that resolve into this repo
Options:
  -r, --repo PATH       Repo root (default: parent of bin/ containing this script)
  -c, --canonical STEM  Instruction stem without .md (default: default)
  --dry-run             Print actions only
  -h, --help            Show this help
Env:
  INSTRUCTIONS_SYMLINKS_MANIFEST  Path to manifest (default: <repo>/bin/instructions-symlinks.paths)
```

```bash
bin/maintain-instructions-symlinks link
bin/maintain-instructions-symlinks link -c <stem>
bin/maintain-instructions-symlinks unlink
bin/maintain-instructions-symlinks --dry-run link
```

**Safety:** `unlink` only removes symlinks whose target resolves within this repo. Non-symlink files are warned and skipped. Broken symlinks are not removed.

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

- Plans and specs live under `.knowledge/`, following the user's preferred paths for Superpowers skills:
  - `brainstorming` specs: `.knowledge/docs/specs/`
  - `writing-plans` plans: `.knowledge/notes/plans/`

## Agent Preferences

- **All responses must be in Chinese.**
- **Git worktree directory:** `~/.config/worktrees`

## Important Notes

- `skills/magicdoor-skills/` is a **standalone git repository**. Any file changes inside it must be committed and pushed from within that directory, not from the `agents-for-myself` root.
- This repository has **no build system, tests, or package manager** — it is a configuration and documentation repository.
- Bash scripts use `set -euo pipefail` and follow consistent CLI conventions (short options, `--dry-run`, `--help`).
- When modifying `bin/` scripts, maintain consistency with existing scripts' error handling and argument parsing style.
