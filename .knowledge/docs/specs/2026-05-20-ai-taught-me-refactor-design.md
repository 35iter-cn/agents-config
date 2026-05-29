---
title: AI-taught-me 技能改造设计
date: 2026-05-20
status: draft
tags: [skill, refactor, ai-taught-me, magicdoor-skills]
---

# AI-taught-me 技能改造设计

## 背景与目标

当前 `ai-taught-me` SKILL.md 使用硬编码关键词匹配（`"记下来"`, `"查一下"` 等）做 mode 分发。这种方式的缺点是：

- 用户必须使用特定 trigger 词才能触发正确 mode
- 缺乏 `--mode` 显式标志机制，与项目中其他技能风格不一致
- 结构松散，没有使用 `<objective>/<process>/<critical_rules>` 等 XML 标签

本次改造目标：
1. 引入 `--mode write|query` 显式参数
2. 无 `--mode` 时通过语义推断（llm 判断）确定 mode
3. 采用 `magicdoor-backend-api` 的 XML 标签结构写 SKILL.md

## 参考源

- **参考技能：** `skills/magicdoor-skills/magicdoor-backend-api/SKILL.md`
- **当前技能：** `skills/magicdoor-skills/ai-taught-me/SKILL.md`
- **当前工作流：** `workflows/common.md`, `workflows/write.md`, `workflows/query.md`

## 设计方案

### Mode 解析三阶段

```
1. --mode write|query 显式指定 → 最高优先级，直接进入对应 workflow
2. 无 --mode，从 prompt 语境推断 → llm 语义判断，直接执行
3. 推断失败 → 列出两种 mode 让用户选择
```

### SKILL.md 结构

采用 XML 标签结构：

```markdown
---
name: ai-taught-me
description: <更新后的描述>
argument-hint: "[--mode write | query] <prompt>"
---

# AI-taught-me

<objective>
知识库记录与查询的两个模式。
</objective>

<execution_context>
@./workflows/common.md
@./workflows/write.md
@./workflows/query.md
</execution_context>

<process>
**`$ARGUMENTS` 有两个部分：`[--mode <value>] <prompt>`**

#### 1. 显式 `--mode` 标志（最高优先级）
- `--mode write` → Write Mode
- `--mode query` → Query Mode
剩余文本作为参数传给对应 workflow。

#### 2. 默认 — 从用户叙述推断 mode
无 `--mode` 时使用完整 prompt 做语义推断。

#### 3. 推断失败 — 列出 mode
</process>

<critical_rules>
- ...
</critical_rules>

<ask_user_instead_of_guessing>
- ...
</ask_user_instead_of_guessing>
```

### 工作流文件

- **`common.md`**：保留现有内容（知识库结构、模板、命名规范），引用方式改为 `@./workflows/common.md`
- **`write.md`**：保留现有步骤，微调以匹配新结构
- **`query.md`**：保留现有步骤，微调以匹配新结构

### 语义推断规则

当没有 `--mode` 时，根据 prompt 语义判断：

| 语境 | 推断 mode | 示例 prompt |
|------|-----------|-------------|
| 包含记录/保存/写/学到的/踩坑/总结等语义 | write | "记录一下今天遇到的 git 冲突解决" |
| 包含查询/找/查一下/搜/怎么/如何等语义 | query | "查一下之前 docker 部署的问题" |
| 模糊不清 | 列出 mode 让用户选择 | "帮我看看 ai-taught-me" |

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `SKILL.md` | 重写 | 采用 XML 标签结构，三段式 mode 解析 |
| `workflows/common.md` | 保留 | 引用方式微调 |
| `workflows/write.md` | 保留 | 微调 |
| `workflows/query.md` | 保留 | 微调 |

## 否决的方案

- **Agent 推导**：启动子 agent 分析 prompt 开销过大，对于二选一的场景用 llm 语义推理已足够
- **纯关键词匹配**：当前方案，缺乏灵活性和自然语言理解能力

## 后续步骤

1. 用户 review spec ✅（当前步骤）
2. 用户批准后 → 调用 `writing-plans` 技能生成实施计划
3. 按计划改造 SKILL.md 和相关 workflow 文件
