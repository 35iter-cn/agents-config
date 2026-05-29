# Query Spec 同一会话内缓存过期漏洞修复设计

## 问题描述

`query-spec` 模式下，第一次查询时模型执行 `cache query` CLI 获取缓存路径，然后使用 `jq`/`grep` 查询内容。在同一会话内的后续查询中，模型可能记住了之前的 `cache_file` 路径，直接跳过 `cache query` 步骤读取文件，导致可能获取到过期的 spec 内容。

## 根因分析

- 原工作流将 "Query cache"（Step 2）和 "Search spec content"（Step 3）分为两个独立步骤
- 模型在 Step 2 获取路径后，将路径记忆在上下文中
- 后续查询时，模型走捷径直接复用记忆中的路径，跳过了可能触发刷新/验证的 CLI 步骤

## 设计方案：原子化查询-搜索流程（方案 B）

将 Step 2 和 Step 3 合并为一个不可分割的原子操作，强调"获取路径后立即查询，不得记忆复用"。

### 更新后的步骤

#### Step 2 — Atomically Query Cache and Search Spec

这一步是**原子操作**，不可分割。必须先通过 CLI 获取最新的缓存路径，然后**立即**在该路径上执行内容搜索。禁止将路径保存、记忆或复用。

##### 2.1 Execute cache query

```bash
npm exec -- @magicdoor/env cache query \
  --service <service> \
  --env <env> \
  --spec-name <spec-name>
```

**Parse output:**
- `ok === true`: success, read `cache_file` for absolute path
- `ok === false`: failure, read `message` for error
- `refreshed === true`: download/refresh was triggered

##### 2.2 Immediately search spec content

获取 `cache_file` 路径后，**在同一操作上下文中立即执行搜索**：

- **Do NOT `cat` or read the entire file**
- 使用 `grep`, `jq` 或其他工具搜索特定 API、schema、path

```bash
jq '.paths | keys[]' <cache_file> | grep <keyword>
jq '.paths["/api/v1/users"]' <cache_file>
jq '.components.schemas.User' <cache_file>
```

### Critical Rules 更新

- 每次搜索 spec 内容前，必须先执行 cache query 获取最新路径
- 禁止将 `cache_file` 路径记忆或保存供后续复用，即使在同一会话中
- 搜索 spec 内容时使用 `grep`、`jq` 等工具按关键字查询；禁止一次性读取整个文件

### Success Criteria 更新

- 每次 spec 查询都重新执行了 `cache query`
- 返回有效的绝对缓存文件路径
- 缓存无效/缺失时触发了自动下载并成功
- Agent 按关键字精确搜索 spec 内容

## 影响范围

仅修改 `/root/.claude/skills/magicdoor-backend-api/workflows/query-spec.md`，不涉及 CLI 工具或其他工作流。
