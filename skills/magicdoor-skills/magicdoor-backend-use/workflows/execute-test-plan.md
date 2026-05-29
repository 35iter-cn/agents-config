# Execute Test Plan

<objective>
Load an existing test plan from `.knowledge/notes/test-plans/` (fallback to `notes/test-plans/`), execute all test cases
via curl, and output concise conclusions to the user. Auto-generate and
re-generate debug tokens throughout execution.
</objective>

<execution_context>
Use `@magicdoor/env -e <env> -s auth -j` to resolve the auth service base URL
for debug token generation, and `@magicdoor/env -e <env> -s <service> -j` to
resolve the target backend service URL.
</execution_context>

<context>
Input: `--step implement` plus a prompt that should match a plan name or describe its content.
Context fallback: if no prompt provided, use conversation history to infer the most relevant plan.
</context>

<process>
### Step 1 — Infer Plan File

Determine the plan directory:
- If `.knowledge/notes/` exists: `.knowledge/notes/test-plans/`
- Otherwise: `notes/test-plans/`

Try to match a plan from `<plan-dir>/*.md`:

1. **From prompt**: extract keywords (service name, endpoint, behavior) and match against plan filenames and content
2. **From context**: if no prompt or no match, use the most recently discussed plan in the conversation
3. **List available**: if inference fails, stop and output:

```
无法确定要执行哪个 test plan。可用的 plan：

1. .knowledge/notes/test-plans/portal-business-info-uploadsessionid.md
2. .knowledge/notes/test-plans/auth-login-field-validation.md
...

请通过 `--step implement "plan 名称"` 指定，或选择序号：
```

### Step 2 — Load and Parse Plan

Read the matched plan file. Extract:
- `env` and `service` from frontmatter
- `user_id` from frontmatter
- `Objective` section
- Each `Test Case`: Endpoint, Payload, Expected
- `Verification` section (optional)

Validate `env` before execution:

- `dev` or `test`: continue
- any other value: stop immediately and tell the user:

```
此环境不支持自动 token，请切换至 dev 或 test。
```

If `user_id` is missing from the frontmatter, stop and ask the user to update the plan or specify the correct user.

### Step 3 — Auto-Get Debug Token

1. Resolve auth base URL:

```bash
npm exec -- @magicdoor/env -e <env> -s auth -j
```

2. Parse the returned `"url"` field as `AUTH_BASE_URL`
3. Generate a debug token:

```bash
curl -s "${AUTH_BASE_URL}/debug/generate-token?userId=<user_id>"
```

4. Parse the bearer token and confirm `expires_in: 3600`
5. Record `token_acquired_at` as the current timestamp for later expiry checks

### Step 4 — Resolve Backend URL

Use `@magicdoor/env` CLI to resolve the service base URL:

```bash
npm exec -- @magicdoor/env -e <env> -s <service> -j
```

Parse JSON output for `"url"` field.

### Step 5 — Execute Test Cases

For each test case in order:

1. **Construct curl command** from Endpoint, Payload, and resolved base URL
2. **Execute curl** (use `-s -w "\nHTTP:%{http_code}"` for silent + status capture)
3. **Parse response**: extract HTTP status and key response fields
4. **Output concise conclusion**:

```
Case 1: Baseline with fileId → 200 ✅
Case 2: uploadSessionId with invalid value → 422 ❌ (UploadSession not found)
Case 3: Both fields together → 400 ❌ (Only one of fileId or uploadSessionId)
```

5. **Check token age** after each case:
   - if elapsed time since `token_acquired_at` is under 50 minutes, continue
   - if elapsed time is 50 minutes or more, call the debug token endpoint again with the same `env` and `user_id`, then replace the in-memory token and reset `token_acquired_at`

### Step 6 — Verification (Optional)

If plan includes a Verification section (e.g., GET to confirm side effects), execute it and output:

```
Verification: GET /company-app/business-info/{id} → 200
最终状态: businessInfoFiles = []
```

### Step 7 — Summarize Results

Output a final summary:

```
测试完成。

**结论：**
- uploadSessionId 可替代 fileId，但需要有效的 session ID
- fileId 和 uploadSessionId 互斥，同时传入会返回 400
- PUT businessInfoFiles 为 [] 会清空所有文件

**发现的约束：**
1. 字段互斥：fileId / uploadSessionId 只能传一个
2. 全量替换：PUT 会替换整个 businessInfoFiles 数组
```
</process>

<critical_rules>
- NEVER save curl responses to disk
- NEVER show full curl raw output to the user — conclusions only
- Stop immediately outside `dev` and `test`; never attempt automatic token generation in other environments
- Never ask the user for `token` or `refresh_token`
- Re-generate the debug token whenever elapsed time since `token_acquired_at` reaches 50 minutes
- If a test case fails unexpectedly, continue with remaining cases unless it's a token/auth failure
- Use `jq` for JSON parsing
- Test case dependencies: if a case references output from a previous case (e.g., sessionId), resolve the variable inline before constructing curl
</critical_rules>

<success_criteria>
- All test cases in the plan are executed
- Token remains valid throughout execution through automatic re-generation
- User receives a concise conclusion for each case and a final summary
- No files are written to disk except the original plan file
</success_criteria>
