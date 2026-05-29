# MagicDoor Backend Test Skill 设计文档

## 概述

将 `direct-backend-api-testing` 重构为 `magicdoor-backend-test`，统一使用 GSD 框架风格，提供 test plan 驱动、自动 token 刷新、复用 `magicdoor-backend-api` spec 查询能力的后端 API 验证 skill。

---

## Skill 元信息

| 属性 | 值 |
|------|-----|
| **Name** | `magicdoor-backend-test` |
| **Description** | Use when needing to verify backend API behavior through direct HTTP calls. Auto-discovers specs via magicdoor-backend-api, manages token lifecycle, and outputs test conclusions only. |
| **Argument Hint** | `[--step brainstorming \| implement] <prompt>` |

---

## 目标

提供两阶段后端 API 验证工作流：

1. **Brainstorming** — 与用户协作设计 test plan，保存到被测试项目的 `notes/test-plans/`
2. **Implement** — 执行已有的 test plan，自动管理 token 生命周期，只输出精简结论

支持"执行 → 反馈 → 更新 plan → 再执行"的持续迭代循环。

---

## 执行上下文

| Workflow | 说明 |
|----------|------|
| `@./workflows/brainstorm-test-plan.md` | Brainstorming 阶段：解析目标、查 spec、与用户讨论、生成 plan |
| `@./workflows/execute-test-plan.md` | Implement 阶段：加载 plan、执行 test cases、汇总结论 |
| `@./workflows/token-manager.md` | Token 生命周期管理：初始验证、定时刷新（refresh token）、过期告警 |

---

## 输入要求

| 输入项 | 必要性 | 说明 |
|--------|--------|------|
| `token` | 必须 | 初始访问令牌 |
| `refresh_token` | 必须 | 用于自动刷新 token |
| `env` | 必须 | 测试环境（dev/test/staging/prod） |
| 测试目标 | 必须 | 自然语言描述要验证的后端行为 |

---

## 流程

### Step 1 — 解析 `--step` 参数

- 显式 `--step brainstorming` → Brainstorming 阶段
- 显式 `--step implement` → Implement 阶段
- 无参数 → 默认 **Brainstorming**

### Step 2a — Brainstorming 阶段

1. **接收用户输入**：token、refresh_token、env、测试目标
2. **解析测试意图**：推断 service、endpoint、关注的行为类型（字段互斥、可选性、omit 语义等）
3. **查询 Spec**：复用 `magicdoor-backend-api` skill 的 `query-specs` 能力获取接口定义
4. **与用户讨论**：确认 baseline payload、变体测试策略、预期行为
5. **生成 Test Plan**：按标准格式写入 `notes/test-plans/<plan-name>.md`
6. **询问是否执行**：用户可选择立即执行或后续用 `--step implement` 执行

### Step 2b — Implement 阶段

1. **推断 plan 文件**：根据用户 prompt 或会话上下文自动匹配 `notes/test-plans/*.md`
2. **无法推断**：停止执行，列出可用的 plan 文件供用户选择
3. **Token 检查**：验证 token 有效期，必要时用 refresh_token 自动刷新
4. **执行 Test Cases**：按 plan 中的 Test Cases 逐项执行 curl
5. **输出结论**：每项只展示精简结论（状态码 + 关键发现）
6. **汇总结果**：总结后端行为约束

### Step 3 — 迭代循环

用户根据测试结果提出新想法 → 回到 Brainstorming 更新 plan → 再次 Implement。

---

## Test Plan 文件格式

Plan 文件保存到**被测试项目**（调用 skill 时的 cwd）的 `notes/test-plans/<plan-name>.md`。

```markdown
---
env: test
service: portal
---

## Objective
验证 business-info 的 uploadSessionId 是否完全替代 fileId

## Test Cases

### Case 1: Baseline with fileId
- **Endpoint**: PUT /company-app/business-info/{id}
- **Payload**: `{"businessInfoFiles": [{"fileType":"businessName","fileId":"abc"}]}`
- **Expected**: 200

### Case 2: uploadSessionId with invalid value
- **Payload**: `{"businessInfoFiles": [{"fileType":"businessName","uploadSessionId":"abc"}]}`
- **Expected**: 422

### Case 3: Both fields together
- **Payload**: `{"businessInfoFiles": [{"fileType":"businessName","fileId":"abc","uploadSessionId":"xyz"}]}`
- **Expected**: 400

## Verification
GET /company-app/business-info/{id} 确认最终状态
```

**格式约束：**
- Frontmatter 必须包含 `env` 和 `service`（service 可以有多个，逗号分隔）
- 正文必须包含 `Objective` 和 `Test Cases` 章节
- 其他章节根据用户需求酌情变化
- 无固定字段限制，Test Case 之间支持依赖链（上一步输出作为下一步输入）

---

## Token 生命周期管理

| 时机 | 行为 |
|------|------|
| 初始 | 记录 `token_acquired_at` 到 plan frontmatter |
| 执行前 | 检查 token 是否过期（15 分钟有效期） |
| 剩余 5-10 分钟 | 使用 refresh_token 自动调用 refresh endpoint 获取新 token |
| 刷新失败 | 停止执行，提示用户重新提供 token + refresh_token |

---

## 关键规则

- **唯一产物**：只有 test plan 文件保存到仓库，curl 命令、响应、日志等不保存
- **复用 Spec 能力**：通过 `magicdoor-backend-api` skill 查询接口定义，不重复实现
- **自动推断 Plan**：`--step implement` 时根据 prompt/上下文自动匹配 plan，无法推断则停止提示
- **精简输出**：只向用户展示结论，不展示完整 curl 原始输出
- **无预设限制**：Test Case 依赖关系、数据传递等按用户要求处理，skill 不做限制

---

## 向用户询问（不猜测）

- 无法推断用户想测试哪个 service/endpoint
- `--step implement` 时无法匹配到任何 plan 文件
- Test Case 的预期行为用户未明确，且 spec 中无定义
- Token 和 refresh_token 均未提供
- `@magicdoor/env` 或 `magicdoor-backend-api` 查询失败

---

## 成功标准

- Brainstorming：用户认可 test plan 的内容并保存到 `notes/test-plans/`
- Implement：所有 Test Cases 执行完毕，向用户输出明确的后端行为结论
- Token：整个执行过程中 token 始终有效，或自动刷新成功
