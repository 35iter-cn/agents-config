# agents-config

Personal agent configuration and skill tree for Claude Code on this machine.

## Structure

| Path | Purpose |
|---|---|
| `skills/` | Canonical source of truth for all Claude Code skills (synced via `bin/sync-skills`) |
| `bin/` | Tooling: skill sync, instruction symlink management |
| `instructions/` | Per-host instruction overrides |
| `.knowledge/` | Design docs, specs, notes (AI-taught-me knowledge base) |

## Quick start

```bash
# Sync skills to ~/.agents/skills
bin/sync-skills
```

See `skills/README.md` for detailed sync instructions and sandbox test steps.
