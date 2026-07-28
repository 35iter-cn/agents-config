---
description: >
  Query MagicDoor backend service configs, analyze swagger specs, and generate
  swagger types via the @magicdoorinc/env package (binary: magicdoor-env).
---

# MagicDoor Backend Swagger

## Ensure CLI

```bash
if ! command -v magicdoor-env >/dev/null 2>&1; then
  pnpm add -g @magicdoorinc/env
fi
```

### Mandatory CLI SOT (`-h`)

**Once per agent session / each time this skill is loaded**, before any
`magicdoor-env` call that needs `-s`, `-e`, or other flags:

```bash
magicdoor-env -h
```

- Do **not** use `-v` (unsupported) or invent flags.
- There is no `-H`; help is `-h` / `--help`.
- Keep the help output as the session **CLI SOT**: allowed services (`-s`
  choices), envs (`-e` choices), portals, and flags.
- Reuse that output for the rest of the session; do not re-guess from memory.
- Optional shorthand after `-h` if you only need names:
  `magicdoor-env --list-services` / `--list-envs` / `--list-portals`.

### Pick `$service` / `$env`

1. **Determine `$service` and `$env`** from conversation context, then
   **map onto names that appear in this session's `-h` output**.
   - Conversational words (`company`, `business`, `hoa service` slang, etc.)
     are **not** valid `-s` values unless they exactly match a listed choice
     (e.g. `companies`, `portal`, `hoa`).
   - If the intent does not clearly match one listed service → ask the user,
     or narrow using `--list-services` + context. **Do not invent a `-s` string.**
   - If a `-s` / `-e` value is rejected by the CLI → re-read the session `-h`
     (or re-run `-h`) and pick a listed name. **Never retry with another guess.**

## SOT Principle

Two complementary sources of truth:

| Concern | SOT |
|---------|-----|
| CLI usage, service/env/flag names | This session's `magicdoor-env -h` output |
| Spec contents for analysis / codegen | Fresh `cache query` result (`cache_file`) |

Project-local swagger types and stale cache files may be outdated — always
query fresh cache before any analysis or type generation.

Service names and spec names are authoritative from `magicdoor-env`,
not from memory or local project config.

## Capabilities

### Query Service Config

```bash
magicdoor-env -e <env> -s <service> -a
```

Add `-j` for JSON output. `$service` / `$env` must be taken from the session
`-h` SOT (see Ensure CLI).

### Analyze a Swagger Spec

1. **Pick `$service` / `$env`** — map conversation intent onto names from this
   session's `-h` SOT (see Ensure CLI → Pick `$service` / `$env`). Do not invent
   `-s` values.

2. **Determine whether the user explicitly specified `$specName`**. Treat the
   user as having named a spec when their request contains patterns like:
   - "`files` 服务的 `Public` spec"
   - "查一下 `Public` spec"
   - "用 `Public` spec"
   - "`Debug` spec of `files`"

3. **If the user explicitly specified `$specName`**:
   1. Query the live spec list:
      ```bash
      magicdoor-env -e $env -s $service -a -j
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
   2. If empty, query available specs and infer from context (or ask the user),
      then optionally persist the mapping to `.magicdoorc`:
      ```bash
      magicdoor-env -e $env -s $service -a -j
      ```

5. **Query the SOT cache** (force — 15 min TTL):
   ```bash
   magicdoor-env cache query --service $service --env $env --spec-name $specName
   ```
   Returns `{ ok, cache_file, refreshed }`. Treat `cache_file` as the single
   source of truth — do not rely on project-local swagger types or previously
   downloaded specs.

6. **Analyze the cache file** with `jq` or `rg` — **never read the full file**.

### Generate Swagger Types

```bash
magicdoor-env gen -e <env>   # defaults to test
```

Add `--no-cache` to force fresh downloads.

## Red Flags

- **Always run `magicdoor-env -h` once per session before selecting `-s`/`-e`** —
  CLI help is the SOT for usage and allowed names.
- **Never invent `-s` (or `-e`) values** — only use names from this session's
  `-h` output. Never retry with another guessed service name after a failure.
- **Never pass conversational synonyms as `-s`** (e.g. `company` / `business`)
  unless they appear verbatim in `-h` choices.
- **Always run `cache query` before analysis** — cache TTL is 15 minutes.
- **Never trust project-local swagger types or stale cache files** — always
  treat a fresh `cache query` result as the single source of truth for specs.
- **Never read full spec files directly** — use `jq`/`rg` on the cache file.
- **No `.magicdoorc`?** Alert the user — required for `gen` and recommended for
  default spec resolution.
- **When the user names a spec explicitly, prefer that name over `.magicdoorc`** —
  but validate it against the live spec list from `magicdoor-env` first.
