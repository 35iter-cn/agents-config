# Brainstorm Test Plan

<objective>
Collaborate with the user to design a test plan for verifying backend API behavior.
Query specs via `magicdoor-backend-specs`, discuss test strategy, and output a
structured test plan file to `.knowledge/notes/test-plans/<plan-name>.md` (fallback to `notes/test-plans/` if `.knowledge/` does not exist).
</objective>

<execution_context>
Use `@magicdoor/env -e <env> -s auth -j` to resolve the auth service base URL
before calling the debug token endpoint.
</execution_context>

<context>
Required inputs from user:
- `env`: target environment — dev, test, staging, prod (required)
- `test target`: natural language description of what to verify (required)
- `userId`: optional testing user id; default `1192372134908579840`
</context>

<process>
### Step 1 — Collect Required Inputs

If any required input is missing, ask the user:

```
开始制定 test plan，需要以下信息：
1. env: 测试环境（dev/test/staging/prod）
2. 测试目标：你想验证的后端行为（例如："business-info 的 uploadSessionId 是否替代 fileId"）
3. userId: 可选，默认 1192372134908579840
```

If the user does not provide `userId`, set it to `1192372134908579840`.

### Step 2 — Validate Environment and Auto-Get Token

Validate `env` before doing any other work:

- `dev` or `test`: continue
- `staging` or `prod`: stop immediately and tell the user:

```
此环境不支持自动 token，请切换至 dev 或 test。
```

For `dev` or `test` only:

1. Resolve auth base URL:

```bash
npm exec -- @magicdoor/env -e <env> -s auth -j
```

2. Parse the returned `"url"` field as `AUTH_BASE_URL`
3. Generate a debug token:

```bash
curl -s "${AUTH_BASE_URL}/debug/generate-token?userId=<userId>"
```

4. Confirm the response contains a usable bearer token and `expires_in: 3600`
5. Record `token_acquired_at` internally for this session; do not expose the token acquisition flow to the user

### Step 3 — Parse Test Intent

From the user's natural language description, infer:
- `service`: backend service name (e.g., portal, auth, pay)
- `endpoint`: API path pattern (e.g., `/company-app/business-info/{id}`)
- `behavior_type`: what kind of behavior to verify
  - field mutual exclusivity
  - field deprecation/transition
  - omission semantics (omit = keep? delete?)
  - empty collection behavior
  - PUT vs PATCH semantics
  - partial update behavior

If inference confidence is low, ask the user to confirm or clarify.

### Step 4 — Query Spec via magicdoor-backend-specs

Use the `magicdoor-backend-specs` skill's `query-specs` capability to retrieve the spec:

1. Resolve the spec for the inferred `service` and `env`
2. Extract the endpoint definition: HTTP method, path parameters, request schema, response schema
3. Identify the relevant fields and their types/constraints

If spec query fails, report the error and ask the user for the endpoint details.

### Step 5 — Discuss Test Strategy with User

Present a proposed test strategy and ask for confirmation:

```
基于 spec 分析，建议按以下策略测试：

**Baseline**: [payload] → 预期 [status]
**Variation 1**: [change] → 预期 [status]
**Variation 2**: [change] → 预期 [status]
**Verification**: [GET endpoint to confirm side effects]

确认这个测试策略吗？需要调整吗？
```

Iterate based on user feedback until the strategy is confirmed.

### Step 6 — Generate Test Plan File

Determine the plan directory:
- If `.knowledge/notes/` exists in the target project (cwd): use `.knowledge/notes/test-plans/`
- Otherwise: use `notes/test-plans/`

Write the test plan to `<plan-dir>/<plan-name>.md`.

**Plan name**: derive from service + endpoint + behavior, kebab-case.
Example: `portal-business-info-uploadsessionid.md`

**File format:**

```markdown
---
env: <env>
service: <service>
user_id: <userId>
---

## Objective
<自然语言描述的测试目标>

## Test Cases

### Case 1: <case description>
- **Endpoint**: <METHOD> <path>
- **Payload**: `<json>`
- **Expected**: <status code> [<optional: expected response body pattern>]

### Case 2: <case description>
- **Endpoint**: <METHOD> <path>
- **Payload**: `<json>`
- **Expected**: <status code>

## Verification
<如何验证副作用，例如 GET 确认最终状态>
```

### Step 7 — Ask Whether to Execute

After saving the plan, ask the user:

```
Test plan 已保存到 <plan-dir>/<plan-name>.md。

1. 立即执行这个 plan
2. 稍后通过 `--step implement` 执行

请选择（1/2）：
```

If user chooses 1, transition to `@./execute-test-plan.md` with the generated plan.
</process>

<critical_rules>
- Always query specs through `magicdoor-backend-specs` — never guess endpoint schemas
- Stop immediately outside `dev` and `test`; never attempt automatic token generation in other environments
- Automatically generate the debug token; never ask the user for `token` or `refresh_token`
- Plan file is the ONLY artifact saved to disk during this phase
- Frontmatter must include `env`, `service`, and `user_id`
- Body must include `Objective` and `Test Cases` sections
- If user declines the proposed strategy, iterate — do not proceed with unconfirmed plan
</critical_rules>

<success_criteria>
- User confirms the test strategy
- Plan file is written to the correct plan directory (`.knowledge/notes/test-plans/` or `notes/test-plans/`)
- Plan contains Objective, Test Cases with Endpoint/Payload/Expected
</success_criteria>
