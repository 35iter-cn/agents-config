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

## Capabilities

### Query Service Config

```bash
npm exec -- @magicdoorinc/env -e <env> -s <service> -a
```

Add `-j` for JSON output. Use `--list-services`, `--list-envs` for discovery.

### Analyze a Swagger Spec

1. **Determine `$service`** and `$env`** from the conversation context. Ask if unclear.
2. **Determine `$specName`**:
   - Check `.magicdoorc`:
     ```bash
     jq -r --arg s "$service" '.swagger[$s].spec // empty' .magicdoorc
     ```
   - If empty, query available specs and infer from context:
     ```bash
     npm exec -- @magicdoorinc/env -e $env -s $service -a -j
     ```
     Optionally persist the mapping to `.magicdoorc`.
3. **Query the SOT cache** (force — 15 min TTL):
   ```bash
   npm exec -- @magicdoorinc/env cache query --service $service --env $env --spec-name $specName
   ```
   Returns `{ ok, cache_file, refreshed }`. Treat `cache_file` as the single
   source of truth — do not rely on project-local swagger types or previously
   downloaded specs.
4. **Analyze the cache file** with `jq` or `rg` — **never read the full file**.

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
- **No `.magicdoorc`?** Alert the user — required for `gen` and recommended for spec resolution.
