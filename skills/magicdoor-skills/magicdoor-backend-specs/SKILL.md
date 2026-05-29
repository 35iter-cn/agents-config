---
name: magicdoor-backend-specs
description: Use when MagicDoor backend OpenAPI schemas are unknown, outdated, or out of sync with frontend TypeScript types. Symptoms include questions about endpoint definitions, missing swagger specs, or Api.ts regeneration needs.
---

# MagicDoor Backend Specs

## Overview

Query cached OpenAPI schemas or regenerate frontend TypeScript types. Integrates with `.magicdoorc` project configuration and the `@magicdoor/env` CLI.

## When to Use

- Questions about a specific backend endpoint, field, or schema
- OpenAPI specs are stale, missing, or need refresh
- TypeScript API types (`Api.ts`) are out of sync with backend
- Frontend migration needs up-to-date backend definitions

## When NOT to Use

- Project has no `.magicdoorc` file (not a MagicDoor-configured project)
- General API design questions unrelated to MagicDoor services

## Process

### Step 1: Determine Mode and Environment

#### `$mode`

| User Request Pattern                                       | Value            |
| ---------------------------------------------------------- | ---------------- |
| Query an interface, field, schema, or endpoint             | `query-specs`    |
| Generate TypeScript types, type sync issues, update Api.ts | `generate-types` |

#### `$env`

Backend environment: `dev` or `test`. Defaults to `test`.

### Step 2: Execute by Mode

#### `query-specs`

1. **Identify `$service`** from the user's request (e.g., "auth login" → `auth`). If unclear, ask the user.
2. **Resolve `$specName`**:
   - Query `.magicdoorc`:
     ```bash
     jq -r --arg s "$service" '.swagger[$s].spec // empty' .magicdoorc
     ```
   - If result is non-empty → use it as `$specName`.
   - If empty → query all specs for this service:
     ```bash
     npm exec -- @magicdoor/env -s $service -a -j -e $env
     ```
     Infer the most appropriate `$specName` from the returned specs based on project context, write the mapping to `.magicdoorc`, and report the inferred choice to the user.
3. **Refresh cache & search**:

3.1. **Refresh cache**

**Mandatory.** Refresh cache → `cache_file`. Must run before every search or specs are stale.

```bash
npm exec -- @magicdoor/env cache query --service $service --env $env --spec-name $specName
```

3.2. **Search**

Search `cache_file` with `jq` or `rg`. **Never** read the full file — specs are large.

#### `generate-types`

1. **Run generation:**

```bash
npm exec -- @magicdoor/env gen -e $env
```

Parse JSON stdout and report results:

```
Swagger Types Updated
─────────────────────────────────────────
Service          Status    Output Path
portal           ✓         src/swagger/portal/Api.ts
─────────────────────────────────────────
Total: N services updated
```
