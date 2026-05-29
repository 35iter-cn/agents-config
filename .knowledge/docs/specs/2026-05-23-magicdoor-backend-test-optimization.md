# MagicDoor Backend Test Skill 优化设计

## 概述

将 `magicdoor-backend-test` skill 从"用户提供 token + refresh_token"模式，重构为"全自动 debug token"模式。基于后端实际测试工作流（`GET /debug/generate-token?userId=xxx`），消除用户手动提供凭证的负担。

---

## 背景

通过实际测试验证，dev/test 环境的 Auth 服务提供 `/debug/generate-token?userId={id}` 接口：

- **无需任何认证**即可调用
- 返回 `expires_in: 3600`（1 小时）的有效 Bearer token
- introspection 返回 `active: true`
- 在 auth/portal 等服务的受保护端点上验证通过

后端团队的 `.http` 测试文件（244 处引用）主要使用此方式获取测试 token，而非 OAuth 密码流程。

**默认测试用户：**
- userId: `1192372134908579840`
- 对应账号: `albus@magicdoor.io` / `12345`
- 权限: PropertyManager, `permissions: *`

---

## 变更范围

### 删除的内容

| 项目 | 原因 |
|------|------|
| 用户输入 `token` | skill 自动获取 |
| 用户输入 `refresh_token` | debug token 1 小时有效期，到期重新生成即可 |
| `workflows/token-manager.md` | 不再需要 token 刷新逻辑 |

### 新增的内容

| 项目 | 说明 |
|------|------|
| 自动 token 获取 | `GET {auth_url}/debug/generate-token?userId={user_id}` |
| 环境验证 | dev/test 外直接停止 |
| 可选 `userId` 输入 | 默认 `1192372134908579840`，用户可覆盖 |
| Token 过期检查 | 执行前检查，50 分钟自动重新生成 |
| Plan frontmatter `user_id` | 记录测试用户以便复现 |

### 保留的内容

- `--step brainstorming | implement` 双阶段结构
- 复用 `magicdoor-backend-api` 查询 spec
- Plan 输出到 `notes/test-plans/`
- 精简结论输出
- 不保存 curl 响应到仓库

---

## 更新后的流程

### Brainstorming 阶段

1. **接收输入**：env（必须）、测试目标（必须）、userId（可选，默认 1192372134908579840）
2. **环境验证**：非 dev/test 则停止并提示
3. **自动获取 token**：调用 debug/generate-token
4. **解析意图**：推断 service、endpoint、行为类型
5. **查询 Spec**：复用 magicdoor-backend-api
6. **讨论策略**：与用户确认 baseline + variations
7. **生成 Plan**：写入 `notes/test-plans/<name>.md`
8. **询问执行**：用户选择立即执行或稍后 `--step implement`

### Implement 阶段

1. **推断 Plan**：从 prompt 或上下文匹配
2. **加载 Plan**：读取 env、service、user_id、test cases
3. **自动获取 token**：根据 plan 中的 env + user_id 调用 debug endpoint
4. **解析后端 URL**：`@magicdoor/env -e {env} -s {service} -j`
5. **执行 Test Cases**：逐项 curl，50 分钟检查点自动刷新 token
6. **输出结论**：精简结果 + 最终汇总

---

## Token 生命周期

```
获取 token
  │
  ▼
记录 token_acquired_at
  │
  ▼
执行 Test Case N
  │
  ▼
检查 elapsed >= 50min?
  │ 否 → 继续下一个 case
  │ 是 → 重新调用 generate-token
  │         ↓
  │      更新 token + token_acquired_at
  │         ↓
  └──────→ 继续下一个 case
```

**无需 refresh_token** — 重新生成比刷新更简单，且 debug token 接口无调用限制。

---

## 环境限制

| 环境 | 行为 |
|------|------|
| `dev` | 正常执行，自动获取 token |
| `test` | 正常执行，自动获取 token |
| `staging` | 停止，提示"此环境不支持自动 token，请切换至 dev 或 test" |
| `prod` | 停止，同上 |

理由：debug 接口在 `IsProduction()` 环境下返回 404，且 API 测试验证不应在生产环境进行。

---

## Plan 文件格式（更新）

```markdown
---
env: test
service: portal
user_id: 1192372134908579840
---

## Objective
验证 business-info 的 uploadSessionId 是否完全替代 fileId

## Test Cases
### Case 1: Baseline with fileId
- **Endpoint**: PUT /company-app/business-info/{id}
- **Payload**: `{"businessInfoFiles": [{"fileType":"businessName","fileId":"abc"}]}`
- **Expected**: 200

## Verification
GET /company-app/business-info/{id} 确认最终状态
```

---

## Workflow 文件变更

| 文件 | 变更 |
|------|------|
| `SKILL.md` | 更新 description、删除 token/refresh_token 输入、更新 critical_rules |
| `brainstorm-test-plan.md` | Step 1 改为收集 env + 可选 userId；新增 Step 2 环境验证 + 自动获取 token；原 token-manager 引用删除 |
| `execute-test-plan.md` | Step 3 改为自动获取 token；删除 token-manager 引用；Step 5 添加 50min 过期检查 |
| `token-manager.md` | **删除** |

---

## 关键规则

- **dev/test 环境外直接停止**，不尝试获取 token
- Token 自动获取对用户完全透明，不在输出中暴露获取过程
- Plan 文件中记录 `user_id` 以便复现和审计
- 唯一产物仍是 plan 文件，curl 响应不保存
- 复用 `magicdoor-backend-api` 查询 spec，不重复实现

---

## 成功标准

- Brainstorming：用户无需提供任何凭证，skill 自动获取有效 token
- Implement：token 在 plan 执行期间始终有效（自动刷新）
- 非 dev/test 环境：清晰提示用户切换环境，不尝试执行
