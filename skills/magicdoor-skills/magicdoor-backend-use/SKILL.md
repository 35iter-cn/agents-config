---
description: |
  Verify backend API behavior through direct HTTP calls with identity-aware
  testing. Auto-detects required user_type from spec names, generates and
  validates debug tokens, queries specs, designs test cases, executes them
  automatically, and outputs concise conclusions.
  Triggers: need to confirm backend field behavior, validate spec assumptions,
  verify endpoint semantics, test local code changes.
---

# MagicDoor Backend Use

## Overview

End-to-end backend API verification workflow:

1. **Understand** — Parse user's test intent (env, service, endpoint, goal)
2. **Environment Check** — Verify target environment is reachable
3. **Query Specs** — List service specs, search endpoint, download spec, extract schema
4. **Confirm Endpoint** — Present inferred endpoint to user for confirmation
5. **Identify Role** — Infer required `user_type` from spec name
6. **Resolve Identity** — Obtain userId for the required role
7. **Generate Token** — Generate and validate debug token
8. **Design Cases** — Auto-generate recommended test cases
9. **Write Plan** — Save test plan with userId (not token) for user confirmation
10. **Execute** — Re-generate token from userId, run all cases automatically
11. **Verify** — Optional: confirm side effects with follow-up requests
12. **Report** — Final summary with findings and response structure

## When to Use

- Verify backend API field behavior (e.g., does `uploadSessionId` replace `fileId`?)
- Validate assumptions about endpoint semantics before frontend migration
- Test local code changes against running backend service
- Verify permission boundaries (which user_type can access which endpoint)
- Confirm query parameter behavior (filtering, sorting, pagination)
- Quick check: "看一下某个接口的 response"
- Full test: "完整测试某个接口的所有参数组合"

## When NOT to Use

- Production or staging environment (no auto-generated tokens)
- Load testing or performance testing
- Testing frontend UI behavior
- When the target endpoint path is completely unknown

## Quick Reference

### Spec Name → Required user_type Mapping

| Spec Name | Path Prefix | Required user_type |
|-----------|-------------|--------------------|
| `InternalApp` | `/internal-app/*` | `MagicDoor` |
| `Debug` | `/debug/*` | `MagicDoor` |
| `Service2Service` | `/service-2-service/*` | `System` or `MagicDoor` |
| `CompanyApp` | `/company-app/*` | `PropertyManager` |
| `CompanyWeb` | `/company-web/*` | `PropertyManager` |
| `TenantApp` | `/tenant-app/*` | `Tenant` |
| `OwnerApp` | `/owner-app/*` | `Owner` |
| `VendorApp` | `/vendor-app/*` | `Vendor` |
| `Homepage` | `/homepage/*` | No auth required |
| `Default` | Mixed (usually empty) | Fallback to path prefix inference |
| `Service2Service` | `/service-2-service/*` | `System` or `MagicDoor` (spec may return 500, use path prefix fallback if needed) |

### Hardcoded Accounts

**Dev MagicDoor Account:**
- userId: `1480743304903122944` (Lei Wang)

**Test MagicDoor Account:** (valid in **test** environment only)
- userId: `1476492890174410752` (Hao Ruan)

## Core Flow

### Phase 1 — Understand Intent

Parse from user prompt:

- `env`: `local` | `dev` | `test` (ask if missing)

> **Local environment**: Business service runs locally (from `launchSettings.json` or user-provided URL), auth service uses **dev** (`https://auth.magicdoor.dev`). When querying specs via `@magicdoor/env` CLI, use `-e dev`.
- `service`: backend service name (ask if cannot infer from context)
- `endpoint`: API path or description (e.g., "portfolio list")
- `goal`: what behavior to verify (e.g., "看一下 response", "完整测试")

If `env` is `staging` or `prod`, stop immediately:
```
This environment does not support auto-generated tokens. Please switch to local, dev, or test.
```

### Phase 2 — Environment Check

**Resolve effective environments:**

| User's env | CLI env (`-e`) | Auth env | Business service |
|-----------|----------------|----------|-----------------|
| `local` | `dev` | `dev` | Local (launchSettings.json or user-provided) |
| `dev` | `dev` | `dev` | Dev |
| `test` | `test` | `test` | Test |

Query auth service URL:
```bash
CLI_ENV="<dev or test>"
npm exec -- @magicdoor/env -s auth -e "$CLI_ENV" -j
# Returns: { "url": "https://auth.magicdoor.dev" }
```

Verify reachability with a HEAD request to the auth URL.

**If unreachable:** Stop immediately. Do NOT auto-downgrade to another environment.

```
⚠️ <env> 环境不可达（DNS 无法解析 / 网络不通）。
请确认网络环境（如 VPN）后重试，或切换至可达的环境。
```

### Phase 3 — Query Specs

**Step 3.1: List all specs for the service**

```bash
CLI_ENV="<dev or test>"  # use dev when user's env is local
npm exec -- @magicdoor/env -s <service> -a -j -e "$CLI_ENV"
```

Returns specs array with `name` and `url` for each spec.

**Step 3.2: Search for the endpoint across all specs**

Search the spec names and endpoint paths for the user's description (e.g., "portfolio").

**Step 3.3: Download the matching spec**

```bash
CLI_ENV="<dev or test>"  # use dev when user's env is local
npm exec -- @magicdoor/env cache query --service <service> --env "$CLI_ENV" --spec-name "<SpecName>"
```

**Step 3.4: Extract endpoint definition**

From the cached spec file, extract:
- HTTP method(s)
- Path (with params)
- Query parameters (name, type, constraints)
- Request body schema
- Response schema (especially 200 OK)

**If no matching endpoint is found:** Stop and ask user for clarification.

### Phase 4 — Confirm Endpoint

Present inferred endpoint to user:

```
推断你要测试的接口：

Service: portal
Spec: CompanyApp
Endpoint: GET /company-app/portfolios
Query Params: active (boolean), name (string), search (string)
Response: HydratedPortfolioDto[]

确认正确吗？如需调整请说明。
```

Wait for user confirmation before proceeding.

### Phase 5 — Identify Required user_type

Look up the spec name in the **Spec Name → Required user_type Mapping** table.

**If spec is `Default` or not in the mapping:** Fallback to path prefix inference:
- `/company-app/*` → `PropertyManager`
- `/tenant-app/*` → `Tenant`
- `/owner-app/*` → `Owner`
- `/vendor-app/*` → `Vendor`
- `/internal-app/*` → `MagicDoor`
- `/service-2-service/*` → `System` or `MagicDoor`
- `/homepage/*` → No auth

Present to user: "Endpoint `{endpoint}` requires `{user_type}` token."

### Phase 6 — Resolve Identity

**If required user_type is `MagicDoor`:**
- Use hardcoded MagicDoor account
- Dev: `1480743304903122944`
- Test: `1476492890174410752`

**If required user_type is NOT `MagicDoor`:**

1. **Generate MagicDoor token** (using hardcoded account)
2. **Query users of the required type:**

```bash
AUTH_URL=$(npm exec -- @magicdoor/env -s auth -e "$CLI_ENV" -j | jq -r '.url')
TOKEN="<MagicDoor_token>"
curl -s "$AUTH_URL/users?userTypes=<user_type>" \
  -H "Authorization: Bearer $TOKEN"
```

Response structure:
```json
{
  "items": [
    {
      "id": 1509910837638352896,
      "name": "pi welcomeTest",
      "email": "18056331291@163.com",
      "companyId": 1509910835432148992,
      "userType": "propertyManager"
    }
  ],
  "page": 1,
  "pageSize": 50,
  "totalCount": 2,
  "totalPages": 1
}
```

> Note: Default `pageSize` is 50. If `totalCount > 50`, paginate or increase `pageSize` parameter.

3. **Present candidate list to user:**

```
找到以下 <user_type> 账户（共 <totalCount> 个），请选择一个生成 token：

1. pi welcomeTest (18056331291@163.com) — companyId: 1509910835432148992
2. Norbert Nemes (norad79@yahoo.com) — companyId: 1375500309804982272

请回复序号（默认选 1）：
```

4. **Use selected userId** for token generation.

> If `items` is empty, stop and inform the user: "该环境下未找到 <user_type> 账户，请提供有效的 userId。"

### Phase 7 — Generate and Validate Token

Query auth URL:
```bash
AUTH_URL=$(npm exec -- @magicdoor/env -s auth -e "$CLI_ENV" -j | jq -r '.url')
```

Generate debug token:
```bash
TOKEN=$(curl -s "$AUTH_URL/debug/generate-token?userId=<userId>" | jq -r '.access_token')
```

> If token generation fails (404 or "user not found"), stop immediately and ask for a valid userId.

Validate token payload:
```bash
echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | jq '{sub, user_type, aud, permissions}'
```

**Validation Rules:**
- `user_type` must match endpoint requirement → ❌ mismatch: stop, ask for correct account
- `aud` should contain `magicdoor.com` → ⚠️ mismatch: warn about environment issue
  - Note: `aud` is returned as an array, e.g., `["magicdoor.com", "magicdoor.com"]`
- `permissions` should cover required scope → ⚠️ missing: warn

**Transparently show user:**
```
Token obtained:
- User: pi welcomeTest (18056331291@163.com)
- user_type: PropertyManager ✅ (matches /company-app/portfolios requirement)
- Company: 1509910835432148992
- Permissions: * (all permissions)
- Expires: 60 minutes
```

### Phase 8 — Design Test Cases

**Auto-generate recommended test cases based on spec analysis:**

For GET list endpoints:
- **Baseline**: No query params → verify basic reachability
- **Per query param**: One case for each param with a valid value
- **Combinations** (optional): Multiple params together

For mutation endpoints (POST/PUT/DELETE):
- **Baseline**: Minimal valid payload → expected 200/201
- **Invalid payload**: Missing required fields → expected 400
- **Read-back verification**: GET to confirm side effects

**Present to user:**
```
根据 spec 分析，推荐的测试策略：

Case 1 (Baseline): GET /company-app/portfolios → expected 200
Case 2: GET /company-app/portfolios?search=My → expected 200
Case 3: GET /company-app/portfolios?active=true → expected 200

确认此测试策略？可以增删改：
```

Iterate based on user feedback until confirmed.

### Phase 9 — Write Test Plan

Save confirmed test plan to:
```
.knowledge/notes/plans/test-plans/<YYYY-MM-DD>-<goal>.md
```

Auto-create directories if they don't exist.

**Test Plan Format:**

```markdown
---
env: dev
service: portal
goal: portfolio list response
required_user_type: PropertyManager
---

## Prepare Token
PropertyManager: userId=1509910837638352896 (pi welcomeTest)

## Case 1 — Baseline
GET /company-app/portfolios

Expect: 200, HydratedPortfolioDto[]

## Case 2 — Search Filter
GET /company-app/portfolios?search=My

Expect: 200, filtered results

## Case 3 — Active Filter
GET /company-app/portfolios?active=true

Expect: 200, only active portfolios
```

**Important:** Test plan stores `userId`, NOT the actual token. Tokens are regenerated before execution.

**Frontmatter fields:**
- `env`: target environment
- `service`: backend service name
- `goal`: test goal (used in filename)
- `required_user_type`: inferred from spec name

### Phase 10 — Execute Test Cases

**Before first case:** Re-generate token from the `userId` in the test plan:
```bash
AUTH_URL=$(npm exec -- @magicdoor/env -s auth -e "$CLI_ENV" -j | jq -r '.url')
TOKEN=$(curl -s "$AUTH_URL/debug/generate-token?userId=<userId_from_plan>" | jq -r '.access_token')
```

**Token age check:** Before each case, check token age. If > 50 minutes, regenerate to avoid expiration (tokens expire at 60 minutes).

**Resolve backend base URL:**

| User's env | Base URL source |
|-----------|----------------|
| `local` | `Apps/<Service>/Properties/launchSettings.json` → `applicationUrl`, or user-provided |
| `dev` / `test` | `npm exec -- @magicdoor/env -e "$CLI_ENV" -s <service> -j` → `url` |

**For each test case (fully automatic, no per-case confirmation):**

1. **Construct curl** from endpoint, payload, and resolved base URL
2. **Execute curl** (`-s -w "\nHTTP:%{http_code}"`)
3. **Parse response:**
   ```bash
   # Separate body and status line
   RESPONSE=$(curl -s -w "\nHTTP:%{http_code}" ...)
   BODY=$(echo "$RESPONSE" | sed '/^HTTP:/d')
   STATUS=$(echo "$RESPONSE" | grep "^HTTP:" | cut -d':' -f2)
   ```
4. **Output concise conclusion:**

```
Case 1: Baseline → 200 ✅ (1 item)
Case 2: search=My → 200 ✅ (1 item)
Case 3: active=true → 200 ✅ (1 item)
```

**For mutation cases:** Auto-execute read-back verification after mutating request.

### Phase 11 — Verification (Auto-triggered for mutations)

**Trigger condition:** Any test case using POST, PUT, PATCH, or DELETE automatically triggers verification.

**Action:** Execute follow-up GET request to confirm side effects:

```
Verification: GET /company-app/portfolios/1509910839802613760 → 200
Final state: active = true
```

### Phase 12 — Report Results

Produce final summary report:

```
## 测试报告

身份: pi welcomeTest (PropertyManager)
Endpoint: GET /company-app/portfolios
环境: dev

| # | Case | 参数 | 状态 | 结果 |
|---|------|------|------|------|
| 1 | Baseline | - | 200 ✅ | 1 item |
| 2 | search=My | search=My | 200 ✅ | 1 item |
| 3 | active=false | active=false | 200 ✅ | 0 items |

## Response 结构

```json
{
  "id": "string (snowflake, 19位)",
  "active": "boolean",
  "name": "string (1-150)",
  "propertyCount": "integer",
  "activePropertyCount": "integer",
  "icons": "string[]",
  "properties": "HydratedPortfolioPropertyDto[]"
}
```

## 发现
1. properties 字段当前为空数组（该 portfolio 下无房产）
2. search 参数支持模糊匹配
3. active 过滤有效
```

## Common Mistakes

- **System token for internal endpoints:** `IsMagicDoor` policy requires `MagicDoor`
  user_type, not `System`. System token works for S2S and Debug endpoints only.
  - Verified: System token → `/internal-app/*` = 403; System token → `/debug/*` = 200.
- **Wrong userId for endpoint type:** PropertyManager userId cannot access
  `/internal-app/*` endpoints. Always check user_type against spec name mapping.
- **Ignoring token validation warnings:** `aud` mismatch often indicates wrong
  environment configuration. Don't ignore it.
- **Reusing tokens across test plans:** Each test plan execution generates a
  fresh token. Never reuse or refresh old tokens.
- **Full curl output to user:** Only output concise conclusions (status + key
  findings), never raw curl responses.
- **Auto-downgrading environments:** If target env is unreachable, STOP. Do not
  silently switch to another environment without user consent.

## Red Flags

- User provides userId whose `user_type` doesn't match endpoint requirement
  → Stop immediately, explain mismatch, suggest correct account type
- `local` environment but `launchSettings.json` not found
  → Ask user for local base URL; auth still uses dev (`https://auth.magicdoor.dev`)
- Token `aud` doesn't match expected audience
  → Warn about environment mismatch before proceeding
- Spec query returns no matching endpoint
  → Don't guess schemas; ask user for clarification
- Service2Service spec returns 500
  → Fallback to path prefix inference (`/service-2-service/*` → `System` or `MagicDoor`)
- Default spec has zero endpoints
  → Fallback to path prefix inference
- Test case returns 401/403
  → First check: does token `user_type` match endpoint requirement?
- Hardcoded MagicDoor account returns "user not found" or 404 on token generation
  → Stop immediately and ask user for a valid userId
- Environment unreachable (DNS NXDOMAIN, connection refused)
  → Stop immediately. Do not auto-downgrade to another environment.
