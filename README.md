# agents-config

Personal AI agent configuration and skill tree for Claude Code.

## Structure

| Path | Purpose |
|---|---|
| `skills/` | Canonical skill source of truth (synced via `bin/sync-skills`) |
| `bin/` | Tooling: skill sync, instruction symlink management |
| `instructions/` | Per-host instruction overrides |
| `.knowledge/` | Design docs, specs, notes |

## Available Skills

### General

| Skill | Purpose |
|---|---|
| `frontend-design` | Production-grade frontend interfaces with high design quality |
| `karpathy-guidelines` | Guidelines to reduce common LLM coding mistakes |
| `mermaid-diagrams` | Software diagrams using Mermaid syntax |
| `grill-me` | Interview the user relentlessly about plans |
| `handoff` | Compress conversation into handoff document |

### MagicDoor

| Skill | Purpose |
|---|---|
| `magicdoor-backend-specs` | OpenAPI spec download, schema query, TypeScript type regeneration |
| `magicdoor-backend-use` | Direct backend API behavior verification via HTTP |
| `magicdoor-backend-issuer` | Autonomous backend bug investigation & issue filing |
| `magicdoor-pr-regression-handoff` | PR creation with regression test docs for QA handoff |
| `magicdoor-pr-uat-cases` | UAT test case generation from PR diff |
| `magicdoor-knowledge-docs-structure` | `.knowledge/` documentation standardization |
| `resolving-rebase-conflicts` | Rebase conflict resolution |
| `rush-monorepo` | Rush monorepo workflows |
| `working-with-solid-use-case` | SolidJS use-case architecture |
| `work-summary` | Work report generation from git commits |
| `ai-taught-me` | AI-taught-me knowledge repository read/write |

## Quick Start

```bash
# Sync skills to ~/.claude/skills and ~/.codex/skills
bin/sync-skills

# Backup existing ~/.agents/skills first
mkdir -p backups
tar -czf "backups/agents-skills-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$HOME" .agents/skills
```

See `CLAUDE.md` for full command reference and architecture decisions.
