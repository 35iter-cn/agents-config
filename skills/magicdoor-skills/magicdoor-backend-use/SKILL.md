---
description: |
  Verify backend API behavior through direct HTTP calls with identity-aware
  testing. Auto-detects required user_type from endpoint paths, generates and
  validates debug tokens, queries specs, designs test cases with the user,
  executes them, and outputs concise conclusions.
  Triggers: need to confirm backend field behavior, validate spec assumptions,
  verify endpoint semantics, test local code changes.
---

# MagicDoor Backend Use

## Overview

End-to-end backend API verification workflow:

1. **Understand** — Parse user's test intent (endpoint, environment, goal)
2. **Identify** — Auto-detect required `user_type` from endpoint path
3. **Confirm Identity** — Confirm identity with user, obtain valid userId
4. **Authenticate** — Generate and validate debug token
5. **Query Specs** — Use `magicdoor-backend-specs` skill to resolve endpoint schema
6. **Design** — Collaboratively design test cases with user
7. **Execute** — Run test cases via curl, output concise conclusions
8. **Verify** — Optional: confirm side effects with follow-up requests
9. **Summarize** — Final report with findings and recommendations

## When to Use

- Verify backend API field behavior (e.g., does `uploadSessionId` replace `fileId`?)
- Validate assumptions about endpoint semantics before frontend migration
- Test local code changes against running backend service
- Verify permission boundaries (which user_type can access which endpoint)
- Confirm query parameter behavior (filtering, sorting, pagination)

## When NOT to Use

- Production or staging environment (no auto-token support)
- Load testing or performance testing
- Testing frontend UI behavior
- When the target endpoint path is completely unknown

## Quick Reference

| Path Prefix            | Required user_type      | Auth Policy         |
| ---------------------- | ----------------------- | ------------------- |
| `/internal/*`          | `MagicDoor`             | `IsMagicDoor`       |
| `/service-2-service/*` | `System` or `MagicDoor` | `IsS2S`             |
| `/company-app/*`       | `PropertyManager`       | `IsPropertyManager` |
| `/tenant-portal/*`     | `Tenant`                | `IsTenant`          |
| `/owner-portal/*`      | `Owner`                 | `IsOwner`           |
| `/vendor-portal/*`     | `Vendor`                | `IsVendor`          |
| `/homepage/*`          | No auth required        | None                |

**Dev MagicDoor Account:**

- userId: `1480743304903122944` (Lei Wang)

**Test MagicDoor Account:**

- userId: `1478272156196851700`

**Generate debug token:**

```bash
# Dev
curl -s 'https://auth.magicdoor.dev/debug/generate-token?userId=1480743304903122944'

# Test
curl -s 'https://auth.magicdoor.test/debug/generate-token?userId=1478272156196851700'
```

**Validate token payload:**

```bash
echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | jq '{sub, user_type, aud, permissions}'
```

## Core Flow

### Phase 1 — Understand Intent

Parse from user prompt:

- `env`: local | dev | test (ask if missing)
- `service`: backend service name (ask if cannot infer)
- `endpoint`: API path (e.g., `/internal/onboardings`)
- `goal`: what behavior to verify (ask if missing)

If `env` is `staging` or `prod`, stop immediately:

```
This environment does not support auto-generated tokens. Please switch to local, dev, or test.
```

### Phase 2 — Identify Required user_type

Auto-detect from endpoint path prefix (see Quick Reference table).

Present to user: "Endpoint `{endpoint}` requires `{user_type}` token."

### Phase 3 — Confirm Identity

Ask user for userId matching the required user_type.

If user doesn't know available accounts, provide the universal MagicDoor account
and show how to query others:

**Dev MagicDoor Account:**

- userId: `1480743304903122944` (Lei Wang)

**Test MagicDoor Account:**

- userId: `1478272156196851700`

> These accounts are known to be valid as of the skill's creation date. If token
> generation fails or returns "user not found", stop immediately and ask the user
> to confirm the account is still active or provide an alternative userId.

**Query Other user_type Accounts:**

```bash
curl 'https://auth.magicdoor.<env>/users?userTypes=<user_type>' \
  -H "Authorization: Bearer <MagicDoor_token>"
```

If env is `local` and current directory is in backend project:

- Derive service base URL from `Apps/<Service>/Properties/launchSettings.json` → `applicationUrl`
- Auth URL: try `http://localhost:5239` first, fallback to `https://auth.magicdoor.dev`

If env is `local` but `launchSettings.json` not found, ask user for base URL.

### Phase 4 — Generate and Validate Token

Resolve auth base URL:

- `local` with local auth available: `http://localhost:5239`
- `local` fallback or `dev/test`: `https://auth.magicdoor.<env>`

Generate debug token:

```bash
# Dev
curl -s 'https://auth.magicdoor.dev/debug/generate-token?userId=1480743304903122944'

# Test
curl -s 'https://auth.magicdoor.test/debug/generate-token?userId=1478272156196851700'
```

> If the debug token endpoint returns an error (e.g., 404 or "user not found"),
> the hardcoded account may have been deactivated. Stop and ask the user for a
> valid userId before proceeding.

Parse and validate token payload:

```bash
echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | jq '{sub, user_type, aud, permissions}'
```

**Validation Rules:**

- `user_type` must match endpoint requirement → ❌ mismatch: stop, ask for correct account
- `aud` must be `magicdoor.com` → ⚠️ mismatch: warn about environment issue
- `permissions` should cover required scope → ⚠️ missing: warn

**Transparently show user:**

```
Token obtained:
- User: Lei Wang (lei+internal@magicdoor.com)
- user_type: MagicDoor ✅ (matches /internal/onboardings requirement)
- Permissions: * (all permissions)
- Expires: 60 minutes
```

### Phase 5 — Query Specs

Invoke the `magicdoor-backend-specs` skill via the `Skill` tool to:

1. Resolve spec for the target service and env
2. Extract endpoint definition: HTTP method, path params, request schema, response schema
3. Identify relevant fields and their types/constraints

If spec query fails, ask user for endpoint details.

### Phase 6 — Design Test Cases

Present proposed test strategy and ask for confirmation:

```
Based on spec analysis, the recommended test strategy is:

Baseline: [payload] → expected [status]
Variation 1: [change] → expected [status]
Variation 2: [change] → expected [status]
Verification: [GET endpoint to confirm side effects]

Confirm this test strategy? Any adjustments needed?
```

Iterate based on user feedback until confirmed.

Save confirmed test plan to `.knowledge/notes/plans/test-plans/<plan-name>.md`
(fallback to `notes/plans/test-plans/`).

**Plan frontmatter:**

```yaml
---
env: dev
service: subscriptions
user_id: 1480743304903122944
required_user_type: MagicDoor
---
```

The test plan must include the debug token generation step using the confirmed
userId. Each test plan execution generates a fresh token — do not reuse or
refresh tokens across executions.

**For permission boundary testing, frontmatter supports:**

```yaml
required_user_types:
  - MagicDoor
  - PropertyManager
```

### Phase 7 — Execute Test Cases

Before executing the first test case, generate a fresh debug token using the
confirmed userId. Do not reuse tokens from previous runs or test plans.

Resolve backend base URL:

- `local`: from `launchSettings.json` `applicationUrl` or user-provided
- `dev/test`: `@magicdoor/env -e <env> -s <service> -j` → parse `"url"`

For each confirmed test case:

1. **Construct curl** from Endpoint, Payload, and resolved base URL
2. **Execute curl** (`-s -w "\nHTTP:%{http_code}"`)
3. **Parse response**: HTTP status and key response fields
4. **Output concise conclusion:**

```
Case 1: Baseline → 200 ✅ (6 items)
Case 2: search=test → 200 ✅ (1 item)
Case 3: statuses=Pending → 200 ✅ (3 items)
```

**For multi-identity plans:** Execute with each `required_user_types` in order,
outputting separate conclusion blocks per identity.

### Phase 8 — Verification (Optional)

If test strategy includes verification, execute follow-up requests to confirm
side effects (e.g., read back created/updated resources):

```
Verification: GET /internal/onboardings/{id} → 200
Final state: statuses = [Pending]
```

This phase validates state changes caused by mutating test cases. It is not a
summary — it is an active verification step.

### Phase 9 — Summarize Results

Produce a final summary report after all test cases and optional verification
are complete:

```
Testing complete.

Identity: Lei Wang (MagicDoor)
Endpoint: GET /internal/onboardings

Findings:
- Baseline (no filter) → 200 ✅ (6 items)
- search=test → 200 ✅ (1 item)
- statuses=Pending → 200 ✅ (3 items)

Constraints discovered:
1. search parameter supports fuzzy matching
2. statuses supports multi-value filtering (comma-separated)
```

## Common Mistakes

- **System token for internal endpoints:** `IsMagicDoor` policy requires `MagicDoor`
  user_type, not `System`. System token only works for S2S and Debug endpoints.
  Reference: `/ai-taught-me/magicdoor/auth-system/cheat-sheet.md`
- **Wrong userId for endpoint type:** PropertyManager userId cannot access
  `/internal/*` endpoints. Always check user_type against path prefix.
- **Ignoring token validation warnings:** `aud` mismatch often indicates wrong
  environment configuration. Don't ignore it.
- **Reusing tokens across test plans:** Each test plan execution must generate a
  fresh token. Never reuse or refresh old tokens.
- **Full curl output to user:** Only output concise conclusions (status + key
  findings), never raw curl responses.

## Red Flags

- User provides userId whose `user_type` doesn't match endpoint requirement
  → Stop immediately, explain mismatch, suggest correct account type
- `local` environment but `launchSettings.json` not found
  → Ask user for base URL instead of guessing
- Token `aud` doesn't match expected audience
  → Warn about environment mismatch before proceeding
- Spec query returns no matching endpoint
  → Don't guess schemas; ask user for clarification
- Test case returns 401/403
  → First check: does token `user_type` match endpoint requirement?
- Hardcoded MagicDoor account returns "user not found" or 404 on token generation
  → Stop immediately and ask user for a valid userId
