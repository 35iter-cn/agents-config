# Skill Repo Cleanup — Post Cache-Manager Migration

> **Date:** 2026-05-02
> **Status:** Draft
> **Scope:** Remove deprecated artifacts after migrating cache-manager logic into `@magicdoor/env` CLI.

---

## 1. Background

The `cache-manager.cjs` logic has been migrated into the `@magicdoor/env` CLI package. The new CLI handles all cache operations internally (transparent cache in `env gen`, `env cache query/download`). As a result, the skill repo no longer needs to:

- Maintain `cache-config.json` for external cache path configuration
- Keep `package.json` / `node_modules` for the old JS-based cache manager
- Reference cache file paths directly in workflow documents

This spec defines the cleanup scope and update rules for all affected files.

---

## 2. Goals

1. **Eliminate deprecated artifacts**: Remove files that are no longer functional or referenced
2. **Decouple workflows from cache internals**: Workflows should interact with CLI only, never with cache file paths
3. **Maintain legacy support**: Keep `codegen-legacy.md` for projects without `.magicdoorc`
4. **Prevent future confusion**: No stale references to `CACHE_CONFIG`, `cache-config.json`, or hardcoded cache paths

---

## 3. Cleanup Scope

### 3.1 Files to Delete

| File | Reason |
|------|--------|
| `cache-config.json` | New CLI uses internal `loadCacheConfig()` (XDG spec); no external config needed |
| `package.json` | Old `magicdoor-backend-api-cache-manager` package definition; skill is now markdown-only |
| `node_modules/` | Old dependency directory; skill no longer executes JS |
| `coverage/` | Old test coverage output from the deprecated JS implementation |

### 3.2 Files to Update

Remove all references to `CACHE_CONFIG` variable, `@$CACHE_CONFIG` directive, and cache path documentation.

| File | Changes Required |
|------|------------------|
| `SKILL.md` | Remove line 29 `CACHE_CONFIG = ...` and line 30 `@$CACHE_CONFIG` |
| `workflows/resolve-spec.md` | Remove `CACHE_CONFIG` in `<execution_context>`; remove "Cache & Artifact Reference" section |
| `workflows/sync-cache.md` | Remove `CACHE_CONFIG` in `<execution_context>`; remove "Cache & Artifact Reference" section |
| `workflows/codegen.md` | Remove `CACHE_CONFIG` in `<execution_context>` |
| `workflows/codegen-cli.md` | Remove `CACHE_CONFIG` in `<execution_context>` |
| `workflows/codegen-legacy.md` | Remove `CACHE_CONFIG` in `<execution_context>`; replace hardcoded `cat {{HOME}}/.cache/...` with dynamic path from `env cache query`; remove "Cache & Artifact Reference" section |

---

## 4. Detailed Changes

### 4.1 `SKILL.md`

**Before:**
```markdown
<execution_context>
SKILL_ROOT = /root/.agents/skills/magicdoor-backend-api
CACHE_CONFIG = /root/.agents/skills/magicdoor-backend-api/cache-config.json
@$CACHE_CONFIG
@./workflows/discover-service-spec-mapping.md
@./workflows/sync-cache.md
@./workflows/resolve-spec.md
@./workflows/codegen.md
</execution_context>
```

**After:**
```markdown
<execution_context>
SKILL_ROOT = /root/.agents/skills/magicdoor-backend-api
@./workflows/discover-service-spec-mapping.md
@./workflows/sync-cache.md
@./workflows/resolve-spec.md
@./workflows/codegen.md
</execution_context>
```

### 4.2 `workflows/resolve-spec.md`

**Remove from `<execution_context>`:**
```markdown
CACHE_CONFIG = /root/.agents/skills/magicdoor-backend-api/cache-config.json
@$CACHE_CONFIG
```

**Remove entire section:**
```markdown
## Cache & Artifact Reference

| Item | Path |
|------|------|
| Config file | `../cache-config.json` |
| Global cache root | `{{HOME}}/.cache/magicdoor-backend-api` |
| Specs cache | `{{HOME}}/.cache/magicdoor-backend-api/api-specs/<service>-<env>-<spec>.json` |
```

**Keep:** All process steps and critical rules. The workflow already delegates to CLI (`npx magicdoor-env cache query`) and does not need cache path documentation.

### 4.3 `workflows/sync-cache.md`

**Remove from `<execution_context>`:**
```markdown
CACHE_CONFIG = /root/.agents/skills/magicdoor-backend-api/cache-config.json
@$CACHE_CONFIG
```

**Remove entire section:**
```markdown
## Cache & Artifact Reference

| Item | Path |
|------|------|
| Config file | `../cache-config.json` |
| Global cache root | `{{HOME}}/.cache/magicdoor-backend-api` |
| Index file | `{{HOME}}/.cache/magicdoor-backend-api/index.json` |
| Specs cache | `{{HOME}}/.cache/magicdoor-backend-api/api-specs/<service>-<env>-<spec>.json` |
```

**Keep:** All process steps and critical rules. The workflow delegates entirely to CLI (`npx magicdoor-env cache download`).

### 4.4 `workflows/codegen.md`

**Remove from `<execution_context>`:**
```markdown
CACHE_CONFIG = /root/.agents/skills/magicdoor-backend-api/cache-config.json
@$CACHE_CONFIG
```

**Keep:** `@./sync-cache.md`, `@./codegen-cli.md`, `@./codegen-legacy.md` references and dispatch logic.

### 4.5 `workflows/codegen-cli.md`

**Remove from `<execution_context>`:**
```markdown
CACHE_CONFIG = /root/.agents/skills/magicdoor-backend-api/cache-config.json
@$CACHE_CONFIG
```

**Keep:** All process steps. This workflow delegates to `npx magicdoor-env gen` which handles cache transparently.

### 4.6 `workflows/codegen-legacy.md`

**Remove from `<execution_context>`:**
```markdown
CACHE_CONFIG = /root/.agents/skills/magicdoor-backend-api/cache-config.json
@$CACHE_CONFIG
```

**Update Step 3 — Replace hardcoded cache path:**

**Before:**
```markdown
1. **Read cached spec from global cache:**
   ```bash
   cat {{HOME}}/.cache/magicdoor-backend-api/api-specs/<service>-<env>-<spec>.json
   ```
```

**After:**
```markdown
1. **Get cached spec path via CLI:**
   ```bash
   npx magicdoor-env cache query --service <service> --env <env> --spec-name <spec>
   ```
   Extract `cache_file` from JSON output.

2. **Read cached spec:**
   ```bash
   cat <cache_file>
   ```
```

**Remove entire section:**
```markdown
## Cache & Artifact Reference

| Item | Path |
|------|------|
| Source specs (cache) | `{{HOME}}/.cache/magicdoor-backend-api/api-specs/<service>-<env>-<spec>.json` |
| Main service output | `src/swagger/Api.ts` |
| Other services output | `src/swagger/<service>/Api.ts` |
| Project config (read-only) | `scripts/generate-swagger.cjs` |
```

**Update `critical_rules`:** Remove references to global cache paths. Keep "Never download specs during type generation" and "Never modify cached spec files" rules.

**Update `success_criteria`:** Remove "Source specs from: <cache-path>" from the report template in Step 5.

---

## 5. Post-Cleanup Directory Structure

```
magicdoor-backend-api/
├── SKILL.md                        # Updated: no CACHE_CONFIG
├── CHANGELOG.md                    # Unchanged
├── docs/
│   └── superpowers/
│       ├── plans/                  # Unchanged
│       └── specs/                  # + this spec
└── workflows/
    ├── codegen.md                  # Updated: no CACHE_CONFIG
    ├── codegen-cli.md              # Updated: no CACHE_CONFIG
    ├── codegen-legacy.md           # Updated: no CACHE_CONFIG, dynamic cache path
    ├── discover-service-spec-mapping.md  # Unchanged (no cache references)
    ├── resolve-spec.md             # Updated: no CACHE_CONFIG, no cache reference table
    └── sync-cache.md               # Updated: no CACHE_CONFIG, no cache reference table
```

---

## 6. Design Decisions

### Why remove cache path documentation entirely?

- **Abstraction boundary**: The skill layer should interact with the CLI interface, not the filesystem. Cache location is an implementation detail of `@magicdoor/env`.
- **Forward compatibility**: If the CLI changes its cache strategy (e.g., adds `--cache-dir` flag, moves to XDG_STATE_HOME), workflow docs won't need updates.
- **DRY principle**: Path information is documented once, in the CLI's own docs. Duplicating it in skill workflows creates maintenance burden.

### Why keep `codegen-legacy.md`?

Legacy projects (without `.magicdoorc`) still need type generation. The legacy workflow:
- Already runs after `sync-cache` ensures specs are cached
- Uses `swagger-typescript-api` directly (not `env gen`)
- Cannot be replaced by CLI codegen

The only change needed is making the cache path acquisition dynamic via `env cache query` instead of hardcoded.

---

## 7. Verification Checklist

After implementation:
- [ ] `cache-config.json` deleted
- [ ] `package.json` deleted
- [ ] `node_modules/` deleted
- [ ] `coverage/` deleted
- [ ] No file contains `CACHE_CONFIG` string
- [ ] No file contains `cache-config.json` string
- [ ] No file contains `{{HOME}}/.cache/magicdoor-backend-api` string
- [ ] No file contains `Cache & Artifact Reference` section
- [ ] `codegen-legacy.md` uses `env cache query` to get spec path
- [ ] `git status` shows only expected deletions and modifications

---

## 8. Rollback

All deletions are tracked by git. If any issue arises:
1. `git checkout -- <file>` to restore individual files
2. `git reset --hard HEAD` to revert all changes
3. Cache data in `~/.cache/magicdoor-backend-api/` is unaffected by this cleanup

---

*Spec ready for review.*
