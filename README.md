# agents-config

Personal AI agent configuration and skill tree for Claude Code.

## Structure

| Path | Purpose |
|---|---|
| `skills/` | Canonical skill source of truth (synced via `scripts/sync-skills.mjs`) |
| `cli/` | User CLI scripts (synced via `scripts/sync-cli.mjs` → `~/.local/bin`) |
| `scripts/` | Tooling: skill/cli sync, instruction symlink management |
| `instructions/` | Per-host instruction overrides |
| `.knowledge/` | Design docs, specs, notes |

## Skill buckets

| Bucket | Purpose |
|---|---|
| `skills/browser-automation/` | Chrome automation |
| `skills/companions/` | Companion runners (`runx`, `tune`) |
| `skills/magicdoor/` | MagicDoor backend / portal / monorepo skills |
| `skills/workflow/` | Spec → PR workflows, grilling, handoff |
| `skills/tools/` | General tooling skills |
| `skills/private/` | Local-only (gitignored) |

## Quick Start

```bash
# Sync skills to ~/.claude/skills
scripts/sync-skills.mjs

# Sync CLI scripts to ~/.local/bin
scripts/sync-cli.mjs
```

See `CLAUDE.md` for full command reference and architecture decisions.
