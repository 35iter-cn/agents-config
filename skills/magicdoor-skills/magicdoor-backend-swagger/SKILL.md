---
description: Query MagicDoor backend service configs, analyze swagger specs, and generate swagger types via the @magicdoorinc/env CLI.
---

# MagicDoor Backend Swagger

## Overview

Use `npm exec -- @magicdoorinc/env` to query backend service configs, analyze swagger specs, and generate project swagger types.

> Full CLI reference: `npm exec -- @magicdoorinc/env --help`

## SOT Principle

The **cache query result** is the single source of truth for spec analysis.
Project-local swagger types and stale cache files may be outdated — always
query fresh cache before any analysis or type generation.

Service names and spec names are authoritative from the `@magicdoorinc/env` CLI,
not from memory or local project config.

## Capabilities

### Query Service Config

```bash
npm exec -- @magicdoorinc/env -e <env> -s <service> -a
```

Add `-j` for JSON output. Use `--list-services`, `--list-envs` for discovery.

### Analyze a Swagger Spec

1. **Determine `$service`** and `$env`** from the conversation context. Ask if unclear.

2. **Determine whether the user explicitly specified `$specName`**. Treat the
   user as having named a spec when their request contains patterns like:
   - "`files` 服务的 `Public` spec"
   - "查一下 `Public` spec"
   - "用 `Public` spec"
   - "`Debug` spec of `files`"

3. **If the user explicitly specified `$specName`**:
   1. Query the live spec list from `@magicdoorinc/env`:
      ```bash
      npm exec -- @magicdoorinc/env -e $env -s $service -a -j
      ```
   2. Match the user's `$specName` against the returned `specs[].name` in this order:
      - **Exact match** → use it.
      - **Case-insensitive match** → use the canonical casing from `env` (e.g. `public` → `Public`).
      - **Fuzzy match** → pick the closest available spec name.
      - **Ambiguous / too dissimilar** → present the available specs to the user and ask them to confirm.

4. **If the user did NOT specify `$specName`**:
   1. Check `.magicdoorc`:
      ```bash
      jq -r --arg s "$service" '.swagger[$s].spec // empty' .magicdoorc
      ```
   2. If empty, query available specs from `@magicdoorinc/env` and infer from
      context (or ask the user), then optionally persist the mapping to `.magicdoorc`:
      ```bash
      npm exec -- @magicdoorinc/env -e $env -s $service -a -j
      ```

5. **Query the SOT cache** (force — 15 min TTL):
   ```bash
   npm exec -- @magicdoorinc/env cache query --service $service --env $env --spec-name $specName
   ```
   Returns `{ ok, cache_file, refreshed }`. Treat `cache_file` as the single
   source of truth — do not rely on project-local swagger types or previously
   downloaded specs.

6. **Analyze the cache file** with `jq` or `rg` — **never read the full file**.

### Generate Swagger Types

```bash
npm exec -- @magicdoorinc/env gen -e <env>   # defaults to test
```

Add `--no-cache` to force fresh downloads.

## Red Flags

- **Always run `cache query` before analysis** — cache TTL is 15 minutes.
- **Never trust project-local swagger types or stale cache files** — always
  treat a fresh `cache query` result as the single source of truth.
- **Never read full spec files directly** — use `jq`/`rg` on the cache file.
- **No `.magicdoorc`?** Alert the user — required for `gen` and recommended for
  default spec resolution.
- **When the user names a spec explicitly, prefer that name over `.magicdoorc`** —
  but validate it against the live spec list from `@magicdoorinc/env` first.
