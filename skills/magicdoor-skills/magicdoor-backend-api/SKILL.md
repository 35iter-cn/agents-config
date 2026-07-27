---
name: magicdoor-backend-api
description: >
  Call MagicDoor backend APIs with identity-aware auth. Resolves swagger specs,
  derives the required token, executes the request, and returns a concise result.
  Use when confirming response fields/format, querying live data, seeding test
  data, or when an agent must hit a real API to continue. Triggers on phrases
  like "查接口", "看 response", "造测试数据", "确认字段", "call API".
---

# MagicDoor Backend API

Core job: **query swagger → derive token → call the API**.

## Prerequisites

1. Load `magicdoor-backend-swagger` — Ensure CLI (`magicdoor-env`), cache query
2. Load `magicdoor-backend-identity` — Spec → user_type, MagicDoor userIds

## When to Use

- Confirm response fields or format against a live endpoint
- Query backend data or create test data via real HTTP
- Agent needs a real response to resolve a swagger/frontend mismatch

## When NOT to Use

- Production or staging (no debug tokens)
- Pure frontend/UI questions
- Load or performance testing
- Local feature-branch diff testing → use `magicdoor-test-from-diff`

## Flow

```
触发 → ① 解析意图 → ② 查 swagger 定接口 → ③ 反推 token → ④ 调用并回报
```

### ① Parse Intent

Extract:

| Variable | Notes |
|----------|-------|
| `env` | Default `test`. `local` = local business + **dev** auth |
| `service` | Ask if unclear |
| `endpoint` | Path or description; ask if unclear |
| `goal` | query / write / verify fields |

Reject `staging` / `prod` immediately.

| User env | CLI `-e` | Auth | Business base URL |
|----------|----------|------|-------------------|
| `local` | `dev` | `dev` | `launchSettings.json` or user-provided |
| `dev` | `dev` | `dev` | `magicdoor-env -s $service -e dev -j` |
| `test` | `test` | `test` | `magicdoor-env -s $service -e test -j` |

If the target env is unreachable, stop. Do not auto-downgrade.

### ② Resolve Endpoint (via swagger)

1. Ensure CLI, then list specs: `magicdoor-env -e $CLI_ENV -s $service -a -j`
2. Cache query: `magicdoor-env cache query --service $service --env $CLI_ENV --spec-name $specName`
3. Extract with `jq`/`rg`: method, path, query/body schema, response schema
4. Present one-line confirmation (can merge into the preview in ③):

```
POST /internal-app/companies | InternalCreateCompanyDto → CompanyDto
```

No matching endpoint → stop. Do not invent schemas.

### ③ Derive Token (via identity)

```
spec name → user_type → userId → generate-token → validate claims
```

- `MagicDoor` → hardcoded userId from identity (env-matched)
- Other roles → MagicDoor token → `GET $AUTH_URL/users?userTypes=$type` → list candidates, **default #1**
- `Homepage` → no token
- Empty users list or `user_type` mismatch → stop

Validate: `user_type` matches requirement; trust `iss` for env.

One-line preview before execute (run unless user said wait):

```
test | POST .../companies | Hao Ruan (MagicDoor) | { companyName: "..." }
```

### ④ Call & Report

```bash
AUTH_URL=$(magicdoor-env -s auth -e "$CLI_ENV" -j | jq -r '.url')
TOKEN=$(curl -s "$AUTH_URL/debug/generate-token?userId=$id" | jq -r '.access_token')
BASE=$(magicdoor-env -s "$service" -e "$CLI_ENV" -j | jq -r '.url')   # or local URL
curl -s -w "\nHTTP:%{http_code}" -H "Authorization: Bearer $TOKEN" ...
```

- Output only: status + key fields / error `detail` / `traceId`
- Never dump raw curl bodies by default
- Non-2xx → report and stop; no blind retries
- Mutations: optional read-back GET after success

## Error Handling

| Status | Action |
|--------|--------|
| 401 | Check env, user_type, iss. Stop. |
| 403 | user_type likely wrong for the spec. Stop. |
| 400 | Show validation detail. Do not guess fixes. |
| 404 | Re-check path via swagger. Stop. |
| 500+ | Log traceId, report, stop. |

## Multi-Step Chains

When the request spans multiple endpoints:

1. Treat each as its own ②→③→④ step
2. Preview the full chain once
3. Execute sequentially; pass step N output into step N+1
4. Any failure → stop and report

## Skill Boundaries

| Scenario | Skill |
|----------|-------|
| Remote/local call, inspect response | **api** (this skill) |
| Feature-branch local diff testing | `magicdoor-test-from-diff` |
| Query swagger / generate types | `magicdoor-backend-swagger` |
| Lookup role / userId | `magicdoor-backend-identity` |
| File a backend GitHub issue | `magicdoor-backend-issuer` |
