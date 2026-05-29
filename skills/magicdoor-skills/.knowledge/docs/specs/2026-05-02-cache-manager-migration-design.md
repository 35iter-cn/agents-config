# Cache Manager Migration to env CLI — Design Spec

> **Date:** 2026-05-02  
> **Status:** Approved  
> **Scope:** Migrate `cache-manager.cjs` logic into `@magicdoor/env` CLI package, update skill workflows to consume new CLI commands.

---

## 1. Goal

Eliminate the circular dependency between `cache-manager.cjs` and `npx magicdoor-env`, simplify the skill workflow architecture, and make `env gen` the single entry point for spec download + type generation.

**Key outcomes:**
- `env gen` transparently uses cache (checks TTL, downloads on miss)
- `--from-cache` flag removed (no longer needed)
- New `env cache` subcommands replace `cache-manager.cjs` CLI interface
- Skill workflows dispatch to `npx magicdoor-env` only, never to `cache-manager.cjs`
- `env-results/` intermediate cache layer removed

---

## 2. Architecture

### Before (Current)

```
Skill Workflow
    │
    ├─ RESOLVE-SPEC: node cache-manager.cjs query-cache
    │                    │
    │                    └─→ npx magicdoor-env -a -j  (get origin + URL)
    │
    ├─ SYNC-CACHE:   node cache-manager.cjs batch-download
    │                    │
    │                    └─→ npx magicdoor-env -a -j  (get origin + URL)
    │
    └─ CODEGEN:      node cache-manager.cjs batch-download
                          │
                          └─→ npx magicdoor-env -a -j
                          │
                          env gen --from-cache <path>
```

**Problems:**
- Circular dependency: cache-manager calls env to get URLs
- Two-step codegen: sync-cache then gen
- `--from-cache` is manual and error-prone
- `env-results/` caches env responses redundantly

### After (Target)

```
Skill Workflow
    │
    ├─ RESOLVE-SPEC: npx magicdoor-env cache query
    │                    │
    │                    └─→ getConfig() (internal, no subprocess)
    │
    ├─ SYNC-CACHE:   npx magicdoor-env cache download
    │                    │
    │                    └─→ getConfig() (internal, no subprocess)
    │
    └─ CODEGEN:      npx magicdoor-env gen
                          │
                          └─→ transparent cache (internal)
```

**Benefits:**
- No circular dependency
- Single command codegen
- Consistent cache behavior across all modes
- Simpler mental model: "env handles everything"

---

## 3. env CLI Repository Standards

All changes to `@magicdoor/env` must strictly follow the existing repository conventions:

### 3.1 Module System
- **ESM only**: `"type": "module"` in `package.json`
- All source files use `import`/`export` syntax
- No CommonJS (`require`/`module.exports`)

### 3.2 Build System (tsup)
- Entry points defined in `tsup.config.ts`:
  - `src/main.ts` — library exports
  - `src/bin.ts` — CLI entry point
- ESM format with sourcemaps
- Production builds drop `console` and `debugger` statements
- **Verify build**: `cd packages/env && npm run build`

### 3.3 TypeScript Configuration
- `tsconfig.json`:
  - `declaration: true` (generates `.d.ts`)
  - `outDir: "dist"`
  - Types: `["node", "jest"]`
  - Libs: `["dom", "dom.iterable", "esnext", "ES2017"]`

### 3.4 Testing Standards (Jest)
- **Test framework**: Jest with `ts-jest` preset
- **Test location**: `src/__tests__/**/*.test.ts`
- **Mocking style**: `jest.mock()` for module mocking
- **Output capture**: Use `captureOutput()` helper pattern (see existing tests)
- **Test structure**:
  ```typescript
  describe('moduleName', () => {
    beforeEach(() => jest.clearAllMocks());
    // tests...
  });
  ```
- **Run tests**: `cd packages/env && npm test`
- **Coverage**: Collect from `src/**/*.ts`, output to `coverage/`

### 3.5 Code Style
- **Naming**: camelCase for variables/functions, PascalCase for classes/types
- **Types**: Strict TypeScript, explicit return types on public functions
- **Error handling**: Use `Error` instances, avoid throwing primitives
- **Async**: Prefer `async/await` over raw Promises
- **File organization**: Co-locate related logic, keep modules focused

### 3.6 Dependency Rules
- **Runtime deps**: Add to `dependencies` in `package.json` only if needed at runtime
- **Dev deps**: Add to `devDependencies` for testing/build tooling
- **Existing deps to reuse**:
  - `commander` — CLI command definitions
  - `jsonc-parser` — JSONC parsing (already used by `.magicdoorc` loader)
  - Node.js built-ins: `fs/promises`, `path`, `os`

### 3.7 Verification Checklist for Each Change
Before committing any env package change:
- [ ] `npm run build` passes without errors
- [ ] `npm test` passes (all existing + new tests)
- [ ] No TypeScript compilation errors
- [ ] New files follow existing naming conventions
- [ ] No `console.log` left in production code (will be dropped by tsup, but still)

---

## 4. env CLI Package Changes

### 4.1 New Command Structure

```
@magicdoor/env
├── gen [-e test|dev] [--no-cache]     # Generate types (default: use cache)
├── cache
│   ├── download -e <env>              # Batch download specs
│   │            --service-spec <s>,<spec> [...]
│   └── query --service <s> --env <e> --spec-name <n>
│                                        # Return cache path (download on miss)
└── (legacy flags) -e -s -p -a -j ...  # Unchanged
```

### 3.2 New/Modified Source Files

```
packages/env/src/
├── cli.ts                          # Modify: add cache subcommand, remove --from-cache
├── gen/
│   ├── run.ts                      # Modify: transparent cache, remove --from-cache parsing
│   ├── cache-reader.ts             # Modify: add getConfig-based path construction
│   └── cache-manager.ts            # Create: new cache logic (extracted from cache-manager.cjs)
├── cache/
│   ├── index.ts                    # Create: cache subcommand entry point
│   ├── download.ts                 # Create: batch-download implementation
│   └── query.ts                    # Create: query-cache implementation
├── config.ts                       # No changes (already provides service origins)
└── __tests__/
    ├── cli.test.ts                 # Modify: remove --from-cache tests, add cache command tests
    ├── gen-run.test.ts             # Modify: update for transparent cache behavior
    └── cache-manager.test.ts       # Create: tests for new cache module
```

### 3.3 `gen` Command Behavior

**Default (with cache):**
```bash
npx magicdoor-env gen -e test
```

For each service in `.magicdoorc`:
1. Construct cache key: `<service>-<env>-<spec>`
2. Check cache TTL via `cache-manager.ts`
3. **Hit:** read from `~/.cache/magicdoor-backend-api/api-specs/`
4. **Miss:** `getConfig()` → construct URL → download → store → generate
5. Output report to stdout (JSON)

**Force refresh (no cache):**
```bash
npx magicdoor-env gen -e test --no-cache
```

Skip cache check, always download.

### 3.4 `cache` Subcommand

**`cache download`**

Replaces: `node cache-manager.cjs batch-download`

```bash
npx magicdoor-env cache download \
  -e test \
  --service-spec portal,CompanyApp \
  --service-spec auth,Default
```

Flow per service-spec:
1. Check spec cache TTL
2. **Hit:** skip (report `refreshed: false`)
3. **Miss:**
   - `getConfig()` → get service origin
   - Construct spec URL: `${origin}/openapi/${spec}.json`
   - `fetch()` with validation (HTTP 200, `openapi` + `info` fields)
   - Store to `~/.cache/magicdoor-backend-api/api-specs/`
   - Update `index.json`
4. Output JSON report

**`cache query`**

Replaces: `node cache-manager.cjs query-cache`

```bash
npx magicdoor-env cache query \
  --service portal \
  --env test \
  --spec-name CompanyApp
```

Flow:
1. Check spec cache TTL
2. **Hit:** return `{ ok: true, cache_file: "...", refreshed: false }`
3. **Miss:** execute download flow above, return `{ ok: true, cache_file: "...", refreshed: true }`
4. On failure: return `{ ok: false, message: "..." }` with non-zero exit

### 3.5 Cache Directory Structure (Simplified)

**Before:**
```
~/.cache/magicdoor-backend-api/
├── index.json
├── env-results/          # REDUNDANT: caches npx magicdoor-env responses
│   ├── portal-test.json
│   └── auth-test.json
└── api-specs/
    ├── portal-test-CompanyApp.json
    └── auth-test-Default.json
```

**After:**
```
~/.cache/magicdoor-backend-api/
├── index.json
└── api-specs/
    ├── portal-test-CompanyApp.json
    └── auth-test-Default.json
```

`env-results/` removed. `index.json` schema unchanged (still tracks `spec` entries with `cached_at` / `expires_at`).

### 3.6 Cache Manager Module (`cache-manager.ts`)

Extracted and modernized from `cache-manager.cjs`:

```typescript
// cache-manager.ts
export interface CacheConfig {
  cacheDir: string;
  indexFile: string;
  envCacheTtlHours: number;
  specCacheTtlHours: number;
  version: number;
}

export interface CacheEntry {
  cached_at: string;
  expires_at: string;
}

export interface CacheIndex {
  version: number;
  last_updated: string;
  entries: {
    spec: Record<string, CacheEntry>;
  };
}

export function loadCacheConfig(): CacheConfig;
export function readIndex(config: CacheConfig): CacheIndex;
export function writeIndex(config: CacheConfig, index: CacheIndex): void;
export function resolveSpecStatus(service: string, env: string, spec: string, config: CacheConfig): { valid: boolean };
export function writeSpecCache(service: string, env: string, spec: string, payload: unknown, config: CacheConfig): void;
export function getSpecCachePath(service: string, env: string, spec: string, config: CacheConfig): string;
```

Note: No `env` cache functions — env responses are no longer cached separately.

### 3.7 Downloader Module

```typescript
// downloader.ts
export interface DownloadOptions {
  service: string;
  env: string;
  spec: string;
  timeout?: number;
  retries?: number;
}

export interface DownloadResult {
  payload: Record<string, unknown>;
  refreshed: boolean;
}

export async function downloadSpec(options: DownloadOptions): Promise<DownloadResult>;
```

Implementation:
1. `getConfig()` to resolve service origin
2. Construct URL: `${origin.replace(/\/$/, '')}/openapi/${spec}.json`
3. `fetch()` with timeout (default 30s)
4. Validate: HTTP 200, JSON parseable, contains `openapi` + `info`
5. Retry on failure (default 3 attempts, exponential backoff)

---

## 4. Skill Workflow Updates

### 4.1 SKILL.md

Update `<execution_context>` to remove `CACHE_MANAGER` reference. All cache operations go through `npx magicdoor-env`.

Update mode dispatch:

**RESOLVE-SPEC:**
```
- Call `npx magicdoor-env cache query --service <s> --env <e> --spec-name <n>`
- Returns cache file absolute path
- Agent searches spec content by keyword using jq/grep
```

**SYNC-CACHE:**
```
- Discover service → spec mapping
- Call `npx magicdoor-env cache download -e <env> --service-spec <s1>,<spec1> ...`
- Parse JSON report
```

**CODEGEN:**
```
- Check `.magicdoorc` existence
  - Yes: `npx magicdoor-env gen -e <env>`
  - No:  legacy flow (unchanged)
- Parse JSON report
```

### 4.2 workflows/sync-cache.md

**Replace Step 2** (batch download command):

```markdown
**Step 2 — Batch download**

Run cache download with all discovered services:

```bash
npx magicdoor-env cache download \
  -e <env> \
  --service-spec <service1>,<spec-name1> \
  --service-spec <service2>,<spec-name2>
```

The command:
1. Checks spec cache TTL for each service-spec
2. Downloads and validates on cache miss (3 retries, exponential backoff)
3. Stores specs to global cache
4. Updates cache index

Parse JSON output:
- `ok === true`: all specs cached successfully
- `ok === false`: check `message` for failure reason
```

**Remove critical_rules** referencing `node $CACHE_MANAGER`.

### 4.3 workflows/codegen.md

**Replace Step 1** (sync-cache):

```markdown
**Step 1 — Execute codegen**

For `.magicdoorc` projects, run:
```bash
npx magicdoor-env gen -e <env>
```

`env gen` transparently handles cache:
- Checks spec cache TTL for each service
- Downloads on miss using internal `getConfig()`
- Generates TypeScript types
- Outputs JSON report to stdout

For legacy projects, dispatch to `codegen-legacy.md`.
```

**Remove** the separate sync-cache pre-step. It's now internal to `env gen`.

### 4.4 workflows/resolve-spec.md

**Replace query command:**

```markdown
**Step 3 — Query cache**

```bash
npx magicdoor-env cache query --service <service> --env <env> --spec-name <spec-name>
```

- Returns `{ ok: true, cache_file: "<path>", refreshed: <bool> }`
- If cache miss, automatically downloads and stores
- If download fails, returns `{ ok: false, message: "..." }`
```

### 4.5 workflows/codegen-cli.md

**Simplify to:**

```markdown
# Codegen CLI Workflow

<objective>
Generate TypeScript type files using `npx magicdoor-env gen` for `.magicdoorc` projects.

**Prerequisite:** None (gen handles cache internally)
**Output:** Updated TypeScript type definitions
</objective>

<process>

**Step 1 — Run gen**

```bash
npx magicdoor-env gen -e <env>
```

**Step 2 — Parse report**

- Parse JSON stdout report
- Check total/success/failed counts
- Report results

</process>

<critical_rules>
- Do not modify project code or generation scripts
- Do not construct URLs manually
</critical_rules>

<success_criteria>
- CLI returns JSON report with success status
- TypeScript files generated in src/swagger/<service>/Api.ts
</success_criteria>
```

### 4.6 New workflow file to delete

- `cache-manager.cjs` — **deprecated**, functionality moved to env CLI
- `cache-manager.test.cjs` — **deprecated**, tests moved to env package

---

## 5. Data Flow Comparison

### Current: CODEGEN Mode (6 steps)

```
1. Skill: discover service-spec mapping
2. Skill: node cache-manager.cjs batch-download
3.   cache-manager: for each service:
4.     cache-manager: npx magicdoor-env -a -j  (get origin)
5.     cache-manager: download spec
6. Skill: npx magicdoor-env gen --from-cache <path>
7.   env: read cached specs
8.   env: generate types
```

### New: CODEGEN Mode (3 steps)

```
1. Skill: discover service-spec mapping
2. Skill: npx magicdoor-env gen -e <env>
3.   env: for each service:
4.     env: check cache TTL
5.     env: getConfig() (internal) → origin
6.     env: download on miss / read on hit
7.     env: generate types
8.   env: output report
```

Steps reduced from 8 to 8, but subprocess calls reduced from 3 to 1, and no circular dependency.

---

## 6. Testing Strategy

### env CLI Package

1. **Unit tests for `cache-manager.ts`**
   - TTL calculation
   - Index read/write
   - Cache hit/miss detection
   - File path construction

2. **Unit tests for `downloader.ts`**
   - URL construction
   - HTTP fetch with mock
   - Retry logic (3 attempts)
   - JSON validation

3. **Integration tests for `cache` commands**
   - `cache download` with mock server
   - `cache query` hit/miss scenarios
   - Cache file creation and index update

4. **Update `gen-run.test.ts`**
   - Remove `--from-cache` tests
   - Add transparent cache tests:
     - Cache hit: no network call
     - Cache miss: download + generate
     - `--no-cache`: always download

5. **Update `cli.test.ts`**
   - Remove `--from-cache` option assertions
   - Add `cache` subcommand help tests
   - Add `gen --no-cache` tests

### Skill Workflows

1. **End-to-end test:** Run `npx magicdoor-env cache download` against real backend (or mock)
2. **End-to-end test:** Run `npx magicdoor-env gen` with empty cache, verify download + generation
3. **End-to-end test:** Run `npx magicdoor-env gen` with warm cache, verify no redundant download

---

## 7. Rollback Plan

If issues arise:

1. **env CLI:** Revert to previous version, `--from-cache` still supported in older versions
2. **Skill:** SKILL.md references `npx magicdoor-env` — if env CLI has bug, skill can temporarily fall back to old cache-manager by checking env version
3. **Cache data:** `~/.cache/magicdoor-backend-api/` format unchanged, backward compatible

---

## 8. Migration Checklist

### Phase 1: env CLI
- [ ] Create `cache-manager.ts` module
- [ ] Create `downloader.ts` module
- [ ] Implement `cache download` command
- [ ] Implement `cache query` command
- [ ] Update `gen` to transparent cache (default) + `--no-cache`
- [ ] Remove `--from-cache` from CLI
- [ ] Write tests
- [ ] Build and verify
- [ ] Publish new version

### Phase 2: Skill Workflows
- [ ] Update `SKILL.md` execution context and mode descriptions
- [ ] Update `workflows/sync-cache.md`
- [ ] Update `workflows/codegen.md`
- [ ] Update `workflows/codegen-cli.md`
- [ ] Update `workflows/resolve-spec.md`
- [ ] Delete `cache-manager.cjs`
- [ ] Delete `cache-manager.test.cjs`
- [ ] Verify all workflows with real project

---

## 9. Open Questions

1. **Versioning:** Should env CLI bump major version (breaking change: `--from-cache` removed)?
2. **Legacy support:** How long to keep `cache-manager.cjs` in skill repo as fallback?
3. **Cache directory customization:** Do we need `--cache-dir` flag for CI or multi-user scenarios?

---

*Spec written. Ready for implementation planning.*
