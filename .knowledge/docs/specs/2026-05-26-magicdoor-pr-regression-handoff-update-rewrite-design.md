---
title: magicdoor-pr-regression-handoff update 模式重写设计
date: 2026-05-26
status: draft
---

## 背景

`magicdoor-pr-regression-handoff` skill 的 update 模式当前采用"保留现有 PR body + 追加新内容"策略。这导致 PR body 在多次更新后累积过时信息，与实际代码状态不符。QA 看到的可能是新旧混杂、甚至自相矛盾的文档。

## 问题陈述

- PR body 的"保留+追加"策略会累积垃圾信息
- `--skip-regression-doc` 参数增加了不必要的复杂度
- update 模式与 create 模式的 body 生成逻辑不一致
- 变更分析范围不一致（update 用 `origin/{branch}..HEAD`，create 用 `origin/master..HEAD`）

## 设计决策

### 1. PR body：完全重写

update 模式不再保留任何现有 PR body 内容。每次 update 都基于当前代码状态重新生成完整的 PR body，确保内容始终与实际代码一致。

- 不复用旧内容
- 不保留人工编辑的上下文（业务背景、设计决策等应放在 issue/文档中）
- 不追加"Recent Changes"等 update 特有章节

### 2. 重写基准：PR template

update 模式重新读取 repo 中的 PR template，填入当前代码衍生的内容。这保证 create 和 update 的 PR 格式始终一致。

- 推翻原 critical rule："Do not re-apply a PR template during update flow"
- create 和 update 共享同一套 body 生成逻辑

### 3. 变更分析范围统一

| 模式 | 变更分析范围 | 用途 |
|------|-------------|------|
| create | `origin/master..HEAD` | 生成完整 PR body |
| update | `origin/master..HEAD` | 生成完整 PR body（统一） |
| update (Updates) | `origin/{branch}..HEAD` | 回归文档的增量历史记录 |

### 4. 回归文档：保留历史，追加 Updates

回归文档 `{resolved-docs-path}/{feature-slug}-regression.md` 保留历史 Updates 章节，每次 update 追加新的 Update 条目。

**路径规则**：与 `create-pr.md` 完全一致，使用 `{resolved-docs-path}/{feature-slug}-regression.md`，而非 `regression-{feature}.md`。

Updates 格式：

```markdown
## Updates

### {YYYY-MM-DD} Update

Changes in this update:

- {commit message}
- {commit message}

New regression test cases:
| Step | Action | Expected |
|------|--------|----------|

New code entry points:
| Description | File |
|-------------|------|
```

**Updates 去重**：同日多次 update 时，若已存在该日期的 `### {YYYY-MM-DD} Update` 条目，将新变更追加到该条目下（在原有 commit 列表后追加新 commit），而非创建第二个同日条目。

### 5. PR Body 生成策略

#### 5.1 Template 驱动

删除 `--skip-regression-doc` 参数。改为在 PR template 中放置标记 `REGRESSION_DOC_HERE`：

- Skill 读取 template 时发现 `REGRESSION_DOC_HERE` → 生成/更新回归文档 → 替换标记为实际链接
- Template 中没有标记 → 不生成回归文档
- 这是 PR body 生成流水线的一个环节，不是独立参数

#### 5.2 无 Template 时的 Fallback

Create 和 update 共用相同的 fallback 策略：

- **有 template**：读取 template → 替换 `REGRESSION_DOC_HERE` → 在 template 内容后追加其余动态内容（Summary, File changes, Where-to-test 等）
- **无 template**：直接生成完整 body，结构与 create 模式的 fallback 一致

Template 检测顺序（create/update 共用）：
1. `.github/pull_request_template.md`
2. `docs/PR_TEMPLATE.md`
3. `.github/PULL_REQUEST_TEMPLATE.md`

#### 5.3 动态内容追加规则

Template 中除 `REGRESSION_DOC_HERE` 外，其余动态内容统一追加在 template 内容之后：

- PR Summary（基于 `origin/master..HEAD` 的变更摘要）
- File Changes 表格
- Where-to-test 说明
- Edge cases

**当前阶段范围**：只引入 `REGRESSION_DOC_HERE` 一个占位符。其余内容仍采用"template + 追加"模式。作为 follow-up，可考虑引入更多占位符（如 `SUMMARY_HERE`、`FILE_CHANGES_HERE`）或抽出共享 workflow `@./workflows/generate-pr-body.md`，但不在本轮实现。

### 6. Update 模式流程

```
1. 确认 PR_NUMBER
2. 分析完整分支变更（origin/master..HEAD，用于 PR body）
3. 分析增量变更（origin/{branch}..HEAD，用于 Updates）
4. 解析 docs path
5. [条件] 更新回归文档（如果 template 含 REGRESSION_DOC_HERE）
   - 增量为空：跳过 Updates 追加，不生成空条目
6. [条件] 提交回归文档变更（如果 Step 5 执行了）
7. 运行 pre-push checks
8. Push 分支
9. 重新生成完整 PR body（基于 template + 当前代码状态）
10. 更新 PR（gh pr edit）
11. 验证
```

**增量为空时的行为**：
- `origin/{branch}..HEAD` 返回空（已 push、无新 commit）：仍执行 PR body 重写，但跳过 Step 5 的 Updates 追加。PR body 始终反映当前代码状态，即使代码未变。
- 这是预期行为：用户可能仅想刷新 PR 描述格式。

## 文件变更

### `skills/magicdoor-pr-regression-handoff/SKILL.md`

- 移除 `--skip-regression-doc` 参数
- 更新 `argument-hint`
- 更新 context：移除 `--skip-regression-doc` 相关描述
- 更新 process：改为 template 驱动描述
- 更新 critical_rules：
  - 删除"In update mode, preserve the existing PR body and append only the new changes section"
  - 删除"In update mode, preserve any existing regression doc link..."
  - 添加"In update mode, rebuild the PR body from the template and current code state"
  - 添加"Use REGRESSION_DOC_HERE marker in PR template to control regression doc generation"
- 更新 success criteria

### `skills/magicdoor-pr-regression-handoff/workflows/update-pr.md`

**Step 1 - Analyze Changes**
- 分析范围改为 `origin/master..HEAD`（完整分支变更）
- 同时分析 `origin/{branch}..HEAD`（增量，用于 Updates）
- 删除"如果无新变更则保留旧 body"的逻辑

**Step 3 - Update Regression Doc**
- 删除 `--skip-regression-doc` 条件
- 改为：如果 PR template 包含 `REGRESSION_DOC_HERE` 则执行
- 文档存在 → 追加 Updates
- 文档不存在 → 创建（同 create 流程结构）

**Step 4 - Commit Regression Doc Update**
- 删除 `--skip-regression-doc` 条件
- 改为：如果 Step 3 执行了则提交

**Step 7 - Update PR Body**
- 删除"读取现有 PR body"步骤
- 删除"Preserve the existing PR body entirely"
- 删除"Append a recent changes section"
- 删除"If Step 3 was skipped..."分支逻辑
- 改为：
  1. 读取 PR template
  2. 如果发现 `REGRESSION_DOC_HERE`，替换为回归文档链接
  3. 填充其他 template 变量（变更摘要、文件列表等）
  4. 用生成的 body 完全替换 PR body

**critical_rules**
- 删除"Preserve the existing PR body and append updates instead of rebuilding it"
- 删除"Do not re-apply a PR template during update flow"
- 添加"Rebuild the PR body from template on every update"
- 添加"Replace REGRESSION_DOC_HERE marker with actual link when present"

### `skills/magicdoor-pr-regression-handoff/workflows/create-pr.md`

- 移除 `--skip-regression-doc` 相关逻辑
- 改为：读取 template，发现 `REGRESSION_DOC_HERE` 则生成回归文档并替换标记
- 更新 critical_rules 和 success criteria

## 兼容性

- 现有项目如果 PR template 中没有 `REGRESSION_DOC_HERE`，update 模式将不生成回归文档
- 建议项目维护者在需要回归文档的 PR template 中添加 `REGRESSION_DOC_HERE` 标记
- `--skip-regression-doc` 参数被移除，调用者需要更新使用方式
