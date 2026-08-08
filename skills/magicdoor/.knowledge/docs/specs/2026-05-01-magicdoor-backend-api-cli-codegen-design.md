# MagicDoor Backend API Codegen CLI Mode Design

## Date

2026-05-01

## Context

`@magicdoor/env` v2.8.0 introduces a `gen` CLI subcommand that generates TypeScript types from `.magicdoorc` config. Currently, the skill only supports legacy projects that use `scripts/generate-swagger.cjs`. We need to add support for the new CLI-based generation while maintaining backward compatibility with legacy projects.

## Goals

1. Support `gen --from-cache` mode that reads specs from the skill's global cache instead of downloading
2. Separate CLI and Legacy codegen flows so Legacy can be removed later
3. Update service discovery to recognize `.magicdoorc` as a configuration source
4. Keep sync-cache as a single shared pre-step at the CODEGEN entry point

## Non-Goals

- Do not add custom output path support to CLI mode (migration to `.magicdoorc` implies directory structure adaptation)
- Do not add demo/production env support to `gen` (CLI limitation, out of scope)
- Do not modify existing cache-manager behavior

---

## 1. Three-File Codegen Structure

Replace the single `codegen.md` with:

```
workflows/
├── codegen.md          # Entry: pre-step + dispatch
├── codegen-cli.md      # CLI-GEN flow
└── codegen-legacy.md   # Legacy flow (unchanged)
```

### 1.1 `codegen.md` — Entry Point

**Purpose:** Single shared pre-step + conditional dispatch to CLI or Legacy.

**Process:**

1. **Execute SYNC-CACHE workflow**
   - Run `@./workflows/sync-cache.md` to ensure all required specs are cached
   - If download fails, STOP and report error
   - This step is shared; neither CLI nor Legacy flow repeats it

2. **Detect project configuration source**
   - Check if `.magicdoorc` exists in project root
   - **If yes** → dispatch to `codegen-cli.md`
   - **If no** → dispatch to `codegen-legacy.md`

### 1.2 `codegen-cli.md` — CLI Flow

**Purpose:** Generate types using `npx magicdoor-env gen --from-cache` for `.magicdoorc` projects.

**Prerequisite:** `codegen.md` entry point has already executed sync-cache.

**Process:**

```
Step 1 — Run gen --from-cache
  Skill reads $CACHE_CONFIG to extract cache_dir, then passes it to CLI:
  npx magicdoor-env gen -e <env> --from-cache <cache_dir>

Step 2 — Parse report
  - Parse JSON stdout report
  - Check total/success/failed counts
  - Report results to user
```

**CLI `gen --from-cache` behavior:**
- Reads `cache-config.json` to locate `api-specs` subdirectory
- For each service in `.magicdoorc` swagger config:
  - Reads `<cacheRoot>/api-specs/<service>-<env>-<spec>.json`
  - Passes parsed JSON to `swagger-typescript-api`'s `spec` parameter
  - Outputs to `<outputRoot>/<service>/Api.ts`
- Returns JSON report: `{ env, total, success, failed, items }`

### 1.3 `codegen-legacy.md` — Legacy Flow

**Purpose:** Maintain existing behavior for `scripts/generate-swagger.cjs` projects.

**Changes from current `codegen.md`:**
- Remove Step 1 (sync-cache already done at entry point)
- Keep Steps 2-6 unchanged
- Rename Step 2 → Step 1, Step 3 → Step 2, etc.

---

## 2. CLI `gen --from-cache` Implementation

### 2.1 New CLI Parameter

```bash
npx magicdoor-env gen -e <env> --from-cache <cacheRoot>
```

- `--from-cache` is **required** when using cache-based generation
- `cacheRoot` is the absolute path to cache directory (e.g. `~/.cache/magicdoor-backend-api`)
- CLI does not validate cache TTL — assumes caller has ensured validity
- Without `--from-cache`, CLI falls back to existing URL-based download behavior

### 2.2 CLI Internal Changes

**`src/cli.ts`:**
- Add `--from-cache` option to `gen` command
- Pass value to `runGen`

**`src/gen/run.ts`:**
- Modify `parseGenArgs` to accept `--from-cache <path>` (required when flag is present)
- When `--from-cache` is set:
  - `cacheRoot` is passed directly by caller; no default resolution
  - Resolve `api-specs` subdirectory under `cacheRoot`
  - For each service, construct cache file path: `<cacheRoot>/api-specs/<service>-<env>-<spec>.json`
  - Read file and pass parsed JSON to `generateSwaggerApi({ spec })`
- When not set, keep existing URL-based flow

**`src/gen/swagger.ts`:**
- Already supports `spec` parameter (object) via `swagger-typescript-api`
- No changes needed

### 2.3 Cache-Manager Boundary

CLI **reads** cache-manager output files but **does not**:
- Import or call cache-manager as a dependency
- Execute cache-manager commands
- Write to cache files or index

This is a "read-only consumption" relationship.

---

## 3. Discover Service-Spec Mapping Update

### 3.1 New Step 0: Read `.magicdoorc`

Insert before existing Step 1 in `discover-service-spec-mapping.md`:

```
Step 0 — Read .magicdoorc
  - Check if .magicdoorc exists in project root
  - Parse JSONC (use jsonc-parser)
  - Extract swagger field: { [service]: { spec: string } }
  - Build service -> spec-name mapping
  - If swagger field is complete (all services have spec names):
    → Use this mapping, skip Steps 1-3
  - If incomplete or .magicdoorc does not exist:
    → Continue with existing Steps 1-5
```

### 3.2 Example

`.magicdoorc`:
```jsonc
{
  "swagger": {
    "portal": { "spec": "CompanyApp" },
    "files": { "spec": "Portal" }
  },
  "outputRoot": "src/swagger"
}
```

Discovery output:
- `portal -> CompanyApp`
- `files -> Portal`

---

## 4. SKILL.md Mode Dispatch Update

Current CODEGEN mode dispatch:

```
"update swagger types" → CODEGEN mode
```

Updated dispatch logic:

```
CODEGEN mode:
  1. Execute sync-cache workflow
  2. Check .magicdoorc existence
     - Yes → codegen-cli.md
     - No  → codegen-legacy.md
```

---

## 5. Migration Path

For projects migrating to `.magicdoorc`:

1. Create `.magicdoorc` with swagger service mappings
2. Remove `scripts/generate-swagger.cjs` (optional)
3. Update import paths if output directory structure changed
4. Run `/magicdoor-backend-api update swagger types`

---

## 6. Files to Modify

| File | Change |
|------|--------|
| `@magicdoor/env/src/cli.ts` | Add `--from-cache` option to gen command |
| `@magicdoor/env/src/gen/run.ts` | Support `--from-cache` in `parseGenArgs` and `runGen` |
| `@magicdoor/env/src/gen/swagger.ts` | No changes (already supports `spec`) |
| `SKILL.md` | Update CODEGEN mode dispatch logic |
| `workflows/codegen.md` | Rewrite as entry point with sync-cache + dispatch |
| `workflows/codegen-cli.md` | New file: CLI-GEN flow |
| `workflows/codegen-legacy.md` | New file: extracted from current codegen.md |
| `workflows/discover-service-spec-mapping.md` | Add Step 0 for .magicdoorc |

---

## 7. Success Criteria

- [ ] `npx magicdoor-env gen --from-cache` successfully generates types from cache files
- [ ] `.magicdoorc` projects are auto-detected and use CLI flow
- [ ] Legacy projects continue to work with existing flow
- [ ] Service discovery correctly extracts mappings from `.magicdoorc`
- [ ] CLI does not download specs when `--from-cache` is used
- [ ] JSON report format is preserved

---

## 8. Open Questions

1. ~~Should `cacheRoot` default be hardcoded or read from `cache-config.json`?~~ **Resolved:** `--from-cache` is a required parameter; caller (skill) provides the exact cache root path.
2. How should CLI handle missing cache files (cache exists but file missing)?
3. Should we add a `--dry-run` flag to `gen` for validation without generation?
