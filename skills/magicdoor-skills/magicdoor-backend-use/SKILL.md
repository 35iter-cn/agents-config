---
name: magicdoor-backend-use
description: |
  Use when needing to verify backend API behavior through direct HTTP calls.
  Auto-discovers specs via magicdoor-backend-specs, auto-generates debug tokens
  for dev/test, and outputs test conclusions only.
  Triggers: need to confirm backend field behavior, validate spec assumptions,
  verify endpoint semantics before frontend migration.
argument-hint: "[--step brainstorming | implement] [--case create-company] [--env dev | test] <prompt>"
---

# MagicDoor Backend Test

<objective>
Provide a two-phase backend API verification workflow:

1. **Brainstorming** — Collaboratively design a test plan with the user,
   save it to the target project's `notes/test-plans/`
2. **Implement** — Execute an existing test plan, auto-generate debug tokens,
   output concise conclusions only

Supports continuous iteration: execute → feedback → update plan → re-execute.
</objective>

<execution_context>
@./workflows/brainstorm-test-plan.md
@./workflows/execute-test-plan.md
@./shared/internal-auth.md
@./cases/create-company.md
</execution_context>

<process>
**`$ARGUMENTS` supports routed modes: `[--step <value>] [--case <value>] [--env <value>] <prompt>`**

#### 1. Explicit `--step` flag (highest priority)

- `--step brainstorming` → **Brainstorming** (`@./workflows/brainstorm-test-plan.md`)
- `--step implement` → **Implement** (`@./workflows/execute-test-plan.md`)

Remaining text (e.g., "verify business-info uploadSessionId") is passed to the workflow.

#### 2. Explicit `--case` flag

- `--case create-company` → **Cases: Create Company** (`@./cases/create-company.md`)

Pass `--env <value>` through to the case. If `--env` is omitted, the case defaults to `test`.

#### 3. Default — Brainstorming

Without `--step`, default to **Brainstorming** mode.

Use the full prompt as the test target description. Execute directly — do not ask for confirmation.

</process>

<critical_rules>
- The ONLY artifact saved to the repository is the test plan file (`notes/test-plans/*.md`)
- curl commands, responses, and logs are NEVER saved to disk
- Reuse `magicdoor-backend-specs` skill's `query-specs` capability — do not reimplement spec querying
- Auto token flow is allowed only in `dev` and `test`; for any other environment, stop immediately and ask the user to switch environments
- Token acquisition is fully transparent to the user; do not ask the user for `token` or `refresh_token`
- Test plan frontmatter must include `user_id` so the execution can reproduce the same test identity
- `--step implement`: infer plan file from prompt or conversation context; stop and list available plans if inference fails
- Output concise conclusions only — never dump full curl raw output to the user
- No preset limits on test case dependencies or data passing between cases
</critical_rules>

<ask_user_instead_of_guessing>
- Cannot infer which service/endpoint the user wants to test
- `--step implement`: no matching plan file found in `notes/test-plans/`
- Test case expected behavior is unclear and not defined in the spec
- Brainstorming is missing required `env` or test target
- `user_id` is missing from the plan frontmatter and cannot be inferred safely
- `@magicdoor/env` or `magicdoor-backend-specs` query fails
</ask_user_instead_of_guessing>
