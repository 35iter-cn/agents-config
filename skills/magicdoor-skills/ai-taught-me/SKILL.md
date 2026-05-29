---
name: ai-taught-me
description: Use when the user asks to save documentation to or query the AI-taught-me knowledge repository. Supports writing new knowledge and retrieving existing knowledge via --mode flag or natural language inference.
argument-hint: "[--mode write | query] <prompt>"
---

# AI-taught-me

<objective>
Manage the personal knowledge repository at `/root/code/AI-taught-me` with two modes:

1. **Write** — Document new knowledge (case studies, guides, cheat sheets) into the repository
2. **Query** — Search and retrieve existing knowledge from the repository

</objective>

<execution_context>
@./workflows/common.md
@./workflows/write.md
@./workflows/query.md
</execution_context>

<process>
**`$ARGUMENTS` 有两个部分：`[--mode <value>] <prompt>`**

#### 1. 显式 `--mode` 标志（最高优先级）

- `--mode write` → **Write Mode** (`@./workflows/write.md`)
- `--mode query` → **Query Mode** (`@./workflows/query.md`)

剩余文本（prompt）作为参数传给对应 workflow。

#### 2. 默认 — 从用户叙述推断 mode

无 `--mode` 时，用完整 prompt 做语义推断。直接执行，**不要询问确认**。

推断逻辑：
- 语义倾向"记录/保存/写" → Write Mode
- 语义倾向"查询/搜索/找" → Query Mode

#### 3. 推断失败 — 列出 mode

```
无法确定你要执行的操作：
1. write  — 记录新知识到 AI-taught-me 仓库
2. query  — 从 AI-taught-me 仓库查询已有知识

请选择（1/2）：
```

</process>

<critical_rules>
- 不要猜测 category/topic 路径；不确定时向用户确认
- 禁止创建超过 `category/topic/` 两层深度的目录
- Write Mode 完成后必须 commit + push（MANDATORY）
- Query Mode 不要直接 Read .md 文件，先用 find/grep 定位
- Mode 推断不确定时走"列出 mode"分支，不要强行猜测
</critical_rules>

<ask_user_instead_of_guessing>
- 无法确定是 write 还是 query（推断置信度低）
- write 时不确定 category 或 topic 名称
- query 时搜索无结果，或匹配过多（>10）
- 用户请求的操作超出 write/query 范围
</ask_user_instead_of_guessing>
