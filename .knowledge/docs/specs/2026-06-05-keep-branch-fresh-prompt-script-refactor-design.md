# keep-branch-fresh Prompt + Script 改造设计

## 背景与目标

`keep-branch-fresh` skill 的 SKILL.md 中，push 环节以具体命令 `git push --force-with-lease` 硬编码在 prompt 中。这导致：

- 无法根据上下文（upstream 是否存在）自适应选择推送策略
- 抑制 LLM 的推理能力，机械执行可能不适用于当前场景的命令
- 维护困难：团队 push 策略变化时需要修改 skill 文件

**目标**：将 push 逻辑脚本化，SKILL.md 只保留意图描述和决策框架。

## 方案概述

采用**方案 A：独立 push 脚本 + 意图化 prompt**。

- 新增 `scripts/push-branch.mjs`：封装 push 策略选择逻辑
- 修改 `SKILL.md`：将 "Verify & push" 拆分为两个独立步骤，push 部分改为意图描述
- 移除流程图（本次更新决定删除）
- 新增 `scripts/push-branch.test.mjs`：覆盖正常流程和异常场景

## 脚本接口设计

### `scripts/push-branch.mjs`

**输入**：无 CLI 参数。从 git 上下文推导：
- 当前分支名：`git rev-parse --abbrev-ref HEAD`
- 默认 remote：`git remote`（优先 `origin`，无则取第一个）
- upstream 追踪关系：`git rev-parse --abbrev-ref @{upstream}`

**行为逻辑**：

```
1. 获取当前分支名 BRANCH
2. 尝试检测 upstream：git rev-parse --abbrev-ref BRANCH@{upstream}
   - 成功 → 执行 git push --force-with-lease
   - 失败 → 执行 git push --set-upstream origin BRANCH
3. 输出结果到 stdout
```

**输出格式**（与现有 dry-run/verify 脚本一致）：

```
成功（已有 upstream）：
=== Push ===
Branch: feat/companion-rename-params
Remote: origin
Strategy: force-with-lease
RESULT: pushed

成功（首次推送）：
=== Push ===
Branch: feat/new-feature
Remote: origin
Strategy: set-upstream
RESULT: pushed

失败：
RESULT: failed
Reason: 远程分支有新提交，本地落后。建议重新执行 dry-run。
```

**退出码**：
- `0` — 推送成功
- `1` — 推送失败（通用错误：网络、权限、无 remote 等）
- `2` — 远程有冲突（非快进，需要重新 dry-run）

## SKILL.md 改动

### 步骤拆分

将原有的 `### Verify & push` 拆分为两个独立步骤：

```markdown
### Verify

`skill://keep-branch-fresh/scripts/verify-no-conflicts.mjs`

检查 rebase 是否干净完成。Exits 0 if clean, exits 1 with details if conflict markers remain or rebase is still in progress.

### Push

`skill://keep-branch-fresh/scripts/push-branch.mjs`

将当前分支安全推送到远程。脚本自动检测 upstream 状态并选择推送策略：

- **已有 upstream**：使用安全的 force-push 方式（如 `--force-with-lease`）
- **首次推送**：建立 upstream 追踪关系后推送

**失败处理：**
- exit 1：通用错误（网络、权限等），阅读错误输出后重试或中止
- exit 2：远程分支已有新提交，需要回到 Dry-run 阶段重新评估
```

### Common Mistakes 补充

新增一条：

```markdown
- Push 脚本返回 exit 2 时未回到 dry-run，而是直接重试 push → 会反复失败，浪费 CI 资源。
```

### 移除流程图

本次更新删除原有的 mermaid flowchart。

## 错误处理与边界情况

### 脚本内部处理

| 场景 | 脚本行为 | 退出码 |
|---|---|---|
| 网络超时 | 等待 3 秒后重试一次，仍失败则退出 | 1 |
| 远程拒绝（非快进） | 输出"远程分支有新提交"，退出 | 2 |
| 权限不足（403/SSH 失败） | 直接退出，输出原始错误 | 1 |
| 不在 git 仓库内 | 输出错误，退出 | 1 |
| 多个 remote 存在 | 优先使用 `origin`，如不存在则按字母序取第一个并输出警告 | 0/1/2 |

### LLM 响应策略

脚本退出后，LLM 按以下规则响应：

- **exit 0**：推送成功，流程结束。
- **exit 1**：阅读 stderr 中的错误信息。如果是临时问题（网络抖动），可建议重试一次；如果是权限或配置问题，中止流程并告知用户。
- **exit 2**：**必须**回到 Dry-run 阶段。不要直接重试 push，因为远程状态已变化，dry-run 的结果已失效。

### 不处理的边界情况

以下场景脚本直接透传 git 的错误输出，由 LLM 或用户判断：

- 分支名与 tag 同名导致的歧义
- 子模块未提交时的 push
- pre-push hook 失败

## 测试策略

新增 `scripts/push-branch.test.mjs`，延续现有测试风格（`node:test` + 临时 git 仓库）。

### 测试场景

| 场景 | 测试方法 | 断言 |
|---|---|---|
| 首次推送（无 upstream） | 本地仓库创建分支，关联 bare remote | 输出 `RESULT: pushed`，`Strategy: set-upstream`，exit 0 |
| 已有 upstream 的推送 | 本地仓库已推送过分支，再次 push | 输出 `RESULT: pushed`，`Strategy: force-with-lease`，exit 0 |
| 远程有新提交 | bare remote 有新 commit，本地落后 | exit 2，输出包含"远程分支有新提交" |
| 无 remote | 本地仓库无 remote | exit 1，输出包含错误原因 |

### 测试基础设施

```javascript
function setupRepoWithRemote(base) {
  const remote = join(base, 'remote.git');
  git(['init', '--bare', remote], base);

  const local = join(base, 'local');
  git(['init', '--initial-branch=main'], local);
  git(['config', 'user.email', 'test@test.com'], local);
  git(['config', 'user.name', 'Test'], local);
  // ... 创建初始提交
  git(['remote', 'add', 'origin', remote], local);
}
```

保持与现有测试一致：
- 使用 `mkdtempSync` + `finally { rmSync }` 清理
- 通过 `e.stdout` 捕获脚本失败时的输出
- 断言匹配 `RESULT: xxx` 模式

## 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `scripts/push-branch.mjs` | 新增 | push 策略脚本 |
| `scripts/push-branch.test.mjs` | 新增 | 测试文件 |
| `SKILL.md` | 修改 | 拆分 Verify & push、意图化描述、删除 flowchart、补充 common mistakes |
