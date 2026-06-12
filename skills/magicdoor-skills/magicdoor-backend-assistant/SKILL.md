---
name: magicdoor-backend-assistant
description: >
  Orchestrate MagicDoor backend API calls from natural language requests.
  Automatically resolves environment, obtains the correct auth token via
  magicdoor-backend-auth, discovers endpoints via magicdoor-backend-swagger,
  constructs requests, and executes them. Use when the user asks to call a
  MagicDoor API endpoint, create test data (e.g., "create a test company"),
  query backend data, or verify API behavior. Triggers on phrases like
  "call endpoint", "create test", "hit the API", "check if", "test the backend",
  or any request involving MagicDoor service interactions.
---

# MagicDoor Backend Assistant

## Overview

This skill converts natural language requests into executed MagicDoor API calls.
It composes two sub-skills:

- **`magicdoor-backend-auth`** → How to get the right token for the environment
- **`magicdoor-backend-swagger`** → How to discover and understand endpoints

## Cases (Pre-recorded Flows)

Common operations are pre-recorded as **cases** in the `cases/` directory. Each case file documents the full end-to-end flow: trigger phrases, matched intent, auth, endpoint, request/response schemas, and example execution.

**When a user request matches a case's trigger phrases or intent, skip endpoint discovery and use the case directly.** This saves time and eliminates swagger queries for well-known operations.

### Case Matching Flow

```
User request → scan cases/ directory for trigger/intent match
  ├─ Match found → use case directly (skip Step 3 & 4)
  └─ No match → fall back to full execution flow
```

### Available Cases

| Case | Triggers | Endpoint |
|------|----------|----------|
| [Create Test Company](cases/create-test-company.md) | "弄个 test 环境的公司", "create a test company" | `POST /internal-app/companies` |

### Adding New Cases

When a new flow has been successfully executed, record it as a case:

1. Create `cases/<kebab-case-name>.md` with trigger phrases, matched intent, and the full flow
2. Add a row to the Available Cases table above
3. Subsequent requests matching the triggers will reuse the recorded flow

## Execution Flow

```
0. Check cases → if user request matches a case's trigger phrases, use it directly
1. Parse user request → identify intent (create, query, update, delete)
2. Infer environment → default test, allow dev/test override
3. Obtain auth token → consult magicdoor-backend-auth for correct userId + endpoint
4. Discover endpoints → consult magicdoor-backend-swagger for matching APIs
5. Present preview → show planned endpoint, method, and request body
6. Execute → call the endpoint with the token
7. Return result → concise summary of response
```

## Step 1: Environment Inference

```
User explicitly mentions "test" / "dev" / "prod" → use that
User says nothing → default to test
Current project context suggests otherwise → ask user to confirm
```

## Step 2: Auth Token

1. Load `magicdoor-backend-auth` skill
2. Determine required `user_type` from the target spec (Internal→MagicDoor, CompanyApp→PropertyManager, etc.)
3. Get the correct `userId` for the inferred environment
4. Call `GET https://auth.magicdoor-{env}.com/debug/generate-token?userId={userId}`
5. Validate token claims (especially `user_type` and `iss`)

## Step 3: Endpoint Discovery

1. Load `magicdoor-backend-swagger` skill
2. Query the target service's swagger specs for matching endpoints
3. Use `jq`/`rg` on cached specs — never read full files
4. Confirm request/response schemas with the user if ambiguous

## Step 4: Execution Preview

Before executing, show the user:

```
Plan:
  Environment: test
  Endpoint:    POST https://api.portal.magicdoor-test.com/internal-app/companies
  Auth:        Hao Ruan (MagicDoor)
  Body:        { companyName: "...", ... }

Execute? (yes / no / modify)
```

## Step 5: Execute & Report

- Use `curl -s -w "\nHTTP %{http_code}\n"` with the token
- Parse JSON responses with `jq` for readability
- Report concise results (status + key data), never raw curl output

## Error Handling

| Error | Response |
|-------|----------|
| 401 | Token mismatch. Check env, user_type, and token issuer. Do NOT retry blindly. |
| 403 | Insufficient permissions. Check if the user_type matches the spec requirement. |
| 400 | Request validation failed. Show the error details to the user. Do NOT guess fixes. |
| 404 | Endpoint or resource not found. Re-check the path with swagger. |
| 500+ | Backend error. Log traceId, report to user, stop. |

**Rule**: On any non-2xx error, report the failure and stop. Do NOT attempt automatic retries, token refresh, or request mutation.

## Multi-Step Operations

When a user request spans multiple endpoints (e.g., "create a company and then list its properties"):

1. Treat each endpoint as a separate step
2. Show the full multi-step plan in the preview
3. Execute sequentially
4. Use output from step N as input for step N+1
5. If any step fails, stop and report

## Examples

**Example 1: Create a test company**
```
User: "帮我创建一个 test company"
→ env: test (default)
→ spec: InternalApp → user_type: MagicDoor
→ token: test auth + test userId
→ endpoint: POST /internal-app/companies
→ body: InternalCreateCompanyDto
→ execute → return companyId
```

**Example 2: Query onboarding metrics**
```
User: "看看 test 环境最近 3 个月的 onboarding 数据"
→ env: test
→ spec: InternalApp → user_type: MagicDoor
→ endpoint: GET /internal-app/business/onboarding-metrics?months=3
→ execute → return metrics summary
```

**Example 3: Check a specific company**
```
User: "查一下 test 环境 company 123 的信息"
→ env: test
→ endpoint: GET /internal-app/companies/123
→ execute → return company details
```
