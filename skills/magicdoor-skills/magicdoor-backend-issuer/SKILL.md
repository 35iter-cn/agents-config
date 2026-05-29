---
name: magicdoor-backend-issuer
description: |
  Use when the user explicitly invokes this skill to file a backend issue.
  The LLM autonomously investigates the backend API error from conversation
  context, determines root cause, and files a structured issue in the correct
  backend repository. Returns the issue URL to the user.
argument-hint: "<description of the backend bug or error>"
---

# MagicDoor Backend Issuer

<objective>
When the user invokes this skill, automatically investigate the backend API
error from the conversation context, determine root cause by cross-referencing
API spec and frontend code, and file a structured GitHub issue in the correct
backend repo. Return only the issue URL and a one-line summary.
</objective>

<execution_context>
- magicdoor-backend-specs (query spec for endpoint details)
</execution_context>

<process>

### Step 1 — Query API Spec

Use `magicdoor-backend-specs` skill to query the relevant endpoint's spec:

- Expected DTO schema (request body fields, types, constraints)
- Available alternate endpoints (e.g., upload-sessions)
- Compare the actual request against what the spec expects

### Step 2 — Search Frontend Codebase

Search the frontend codebase for how the feature uses this API:

- Which fields does the frontend send in different scenarios (create vs edit)?
- Any existing patterns for file addition/removal?
- Compare frontend usage against spec to identify mismatches

### Step 3 — Determine Root Cause

| Result | Action |
|--------|--------|
| Frontend sends wrong field | Report to user, fix frontend |
| Frontend sends correct field but backend rejects | **File backend issue** |
| Missing endpoint for the operation | **File backend issue** (feature gap) |

### Step 4 — File Issue in Backend Repo

Target repo: `MagicDoorInc/backend` (monorepo with `Apps/Portal/` matching stack traces).
`MagicDoorInc/portal-backend` is archived — do not use.

Create issue body as a temp file and submit via `gh issue create`:

```bash
gh issue create \
  --repo MagicDoorInc/backend \
  --title "<Concise bug title>" \
  --label "bug" \
  --body-file /tmp/backend-issue.md
```

### Step 5 — Report Result

Output only:

```
Filed: https://github.com/MagicDoorInc/backend/issues/{number}
{One-sentence summary of the bug}
```

</process>

<critical_rules>
- Always query spec via magicdoor-backend-specs before speculating about backend behavior
- Always search frontend codebase before concluding it's a backend bug
- `portal-backend` is archived — always use `backend` monorepo
- Include full error response and stack trace from the conversation context
- Suggest a fix direction but don't prescribe implementation details
- Output only the issue URL and one-line summary — no extra commentary
</critical_rules>

<issue_format_reference>

以下是一个符合标准格式的 issue body，直接作为写入 `/tmp/backend-issue.md` 的模板。content 中的每个字段在提交前需要根据当前上下文填充或推导。

```
## 描述

{What happens, when, and why it's wrong.}

## 复现步骤

1. {Step 1}
2. {Step 2}
3. {Step 3}

## 错误响应

```json
{Full JSON error response body including type, title, status, detail, traceId, exception}
```

## 根因

{What the backend code is doing wrong. Reference the use case / class name from stack trace.}

## 建议修复方向

{Concrete recommendation for the backend team.}

## 补充上下文

{How the frontend uses this endpoint, cross-reference to spec or frontend PR if applicable.}
```

使用说明：
- **描述**：从用户报告和错误响应中提炼，一句话说明问题
- **复现步骤**：从前端操作场景推导，不依赖用户提供
- **错误响应**：直接从会话中提取完整的 JSON error response
- **堆栈**：如果错误响应中已有 `exception.stackTrace`，提取关键路径（`SetCustomFieldValueUseCase.Execute` 级别）
- **根因**：从堆栈信息推导——关注 use case / handler 层的逻辑错误
- **建议修复方向**：基于对 spec 和前端用法的理解，给出方向性建议（后端具体实现由后端团队决定）
- **补充上下文**：前端如何使用该 endpoint，是否有相关 spec / PR

</issue_format_reference>

<real_world_example>
**场景：** PUT custom-fields 传 referenceArray 报 422 AlreadyClaimed

**推导过程：**
1. magicdoor-backend-specs → spec 显示 `referenceArray` 接受 fileId（claim 模式）
2. 搜前端 → `EditMagicTagModal.tsx` 在 edit 模式下把已有文件 ID 放 `referenceArray`
3. 比对 → 前端用法符合 spec，但后端对已有文件重复 claim

**结果：** Issue #471 filed in MagicDoorInc/backend
</real_world_example>
