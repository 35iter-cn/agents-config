---
title: "MagicDoor Backend Skills Rename"
date: "2026-05-23"
status: draft
---

# MagicDoor Backend Skills Rename

## Objective

Rename two MagicDoor backend skills to accurately reflect their function, while keeping the third unchanged. Update all active references within the skills tree.

## Changes

| Current Name | New Name | Reason |
|---|---|---|
| `magicdoor-backend-api` | `magicdoor-backend-specs` | The skill manages OpenAPI **specification documents** (download, query, type generation), not a backend API itself |
| `magicdoor-backend-test` | `magicdoor-backend-use` | Distinguish from frontend unit/integration tests; "use" implies usage verification |
| `magicdoor-backend-issuer` | (unchanged) | Already functionally accurate |

## Scope

### Must change

| # | File | Change |
|---|------|--------|
| 1 | Directory: `magicdoor-backend-api/` | Rename to `magicdoor-backend-specs/` |
| 2 | Directory: `magicdoor-backend-test/` | Rename to `magicdoor-backend-use/` |
| 3 | `magicdoor-backend-specs/SKILL.md` | `name: magicdoor-backend-api` → `magicdoor-backend-specs` |
| 4 | `magicdoor-backend-use/SKILL.md` | `name: magicdoor-backend-test` → `magicdoor-backend-use` |
| 5 | `magicdoor-skills/README.md` | Skill listing entries for both renamed skills |
| 6 | `magicdoor-skills/CLAUDE.md` | Skill listing entries for both renamed skills |
| 7 | `magicdoor-backend-issuer/SKILL.md` | 4 references: `magicdoor-backend-api` → `magicdoor-backend-specs` |
| 8 | `magicdoor-backend-use/workflows/brainstorm-test-plan.md` | 4 references: `magicdoor-backend-api` → `magicdoor-backend-specs` |

### Not in scope

- `~/.cache/magicdoor-backend-api/` — runtime cache path, kept as-is
- `.knowledge/` historical spec/plan documents — archival records, not modified

## Migration Steps

1. Rename directories (`mv`)
2. Update `name` field in both SKILL.md frontmatters
3. Update README.md skill table
4. Update CLAUDE.md skill table
5. Update cross-references in `magicdoor-backend-issuer/SKILL.md`
6. Update cross-references in `magicdoor-backend-use/workflows/brainstorm-test-plan.md`
7. Run `sync-claude-skills link --dry-run` to verify, then `sync-claude-skills link`
