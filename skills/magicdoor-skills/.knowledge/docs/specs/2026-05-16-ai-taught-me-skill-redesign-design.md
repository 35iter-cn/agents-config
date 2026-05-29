# AI-taught-me Skill 模块化改造设计

## 日期
2026-05-16

## 背景

现有 `documenting-to-ai-taught-me` skill 仅支持"写"流程（将知识记录到 `/root/code/AI-taught-me`）。用户希望新增"查"流程，使其成为一个完整的知识库读写入口。同时要求参考 `magicdoor-backend-api` skill 的分流策略，采用模块化设计。

## 目标

1. 在现有"写"流程外新增"查"流程
2. 采用入口文件 + workflow 子文件的模块化结构（复刻 `magicdoor-backend-api` 模式）
3. Skill 名从 `documenting-to-ai-taught-me` 改为 `ai-taught-me`
4. 写流程保留原有行为，查流程支持智能搜索和直接呈现

## 目录结构

```
~/.claude/skills/ai-taught-me/
├── SKILL.md                  # 入口：frontmatter + 分流逻辑
└── workflows/
    ├── common.md             # 共享：目录结构、命名规范、关键词策略、模板
    ├── write.md              # 写流程：创建、撰写、提交
    └── query.md              # 查流程：搜索、匹配、呈现
```

## 关键决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| Skill 名 | `ai-taught-me` | 去掉仅表示"写"的动词，与仓库名一致，自然支持 `/ai-taught-me write` 和 `/ai-taught-me query` |
| 模块化粒度 | 入口 + 3 个 workflow 文件 | 参考 `magicdoor-backend-api`，不过度拆分（非独立 skill），也不单文件膨胀 |
| 查流程匹配策略 | 目录名优先 + 内容搜索 | 目录名（topic）匹配权重最高，内容搜索补充，兼顾速度与准确性 |
| 查流程文件选择 | 默认 cheat-sheet.md | 用户期望快速查阅，cheat-sheet 更精简；需要全上下文时再读 report.md |
| 写流程提交规则 | 强制立即 commit and push | 不可跳过，不可询问用户权限，原有规则保留 |

## SKILL.md 入口设计

```yaml
---
name: ai-taught-me
description: Use when user asks to interact with the AI-taught-me knowledge repository — either saving new documentation or querying existing knowledge. Triggered by explicit write or query commands.
commands:
  - write
  - query
---

# AI-taught-me

## Overview

AI-taught-me is a personal knowledge repository at `/root/code/AI-taught-me`.
This skill provides two modes: **write** (document new knowledge) and **query** (retrieve existing knowledge).

## Mode Dispatch

Parse user command to determine mode:

- `"write"`, `"记下来"`, `"写个文档"`, `"落成报告"`, `"save"` → **Write Mode** (`@./workflows/write.md`)
- `"query"`, `"查一下"`, `"帮我找"`, `"读给我"`, `"search"` → **Query Mode** (`@./workflows/query.md`)
- Ambiguous or no mode specified → List both modes and ask user to specify

**Examples:**
```
/ai-taught-me write    → Write Mode
/ai-taught-me query    → Query Mode
```

## Shared Principles

All workflows share conventions defined in `@./workflows/common.md`.
```

## workflows/write.md 设计

职责：将新知识写入 AI-taught-me 仓库。

核心步骤：
1. 创建目录：`mkdir -p /root/code/AI-taught-me/{category}/{topic}/`
2. 写 report.md：包含日期、上下文、完整命令、验证步骤、恢复方法
3. 提取 cheat-sheet.md：从 report 中抽离快速参考内容
4. 验证两份文件：report 有叙事、cheat-sheet 无叙事、都有关键词
5. **强制提交推送**：`git add . && git commit -m "..." && git push origin master`
   - 不可跳过，不可询问用户权限

## workflows/query.md 设计

职责：从 AI-taught-me 仓库中检索并呈现已有知识。

核心步骤：
1. 提取关键词：从用户 query 中解析搜索词
2. 搜索仓库：
   - `find` 搜索目录名（topic 级别）
   - `grep -r` 搜索文件内容
3. 匹配排序：目录名精确匹配 > 内容关键词匹配 > 相关分类匹配
4. 文件选择：
   - 单一精确匹配 → 直接读取呈现
   - 多匹配 → 列出 Top 3，让用户选择
   - 无匹配 → 提示无结果，提供 browse 选项
5. 智能呈现：
   - 用户要快速参考 → 读 `cheat-sheet.md`
   - 用户要完整背景 → 读 `report.md`
   - 意图不明 → 默认读 `cheat-sheet.md`，提供读 `report.md` 的选项
6. 交叉引用：文档中的 `Related:` 链接可继续追踪

## workflows/common.md 设计

职责：存放 write 和 query 共享的约定。

内容：
- 目录结构：`category/topic/` 两级嵌套
- 文件命名：`report.md` / `cheat-sheet.md` / `README.md`
- 核心原则：Searchable, Self-contained, Two formats, Dated
- 关键词策略：技术名、动作、症状、工具
- Report 模板：带 frontmatter 的标准 Markdown 结构

## 迁移说明

旧 skill 路径：`/root/agents-for-myself/skills/magicdoor-skills/documenting-to-ai-taught-me/`
新 skill 路径：`/root/agents-for-myself/skills/magicdoor-skills/ai-taught-me/`

迁移动作：
1. 创建新目录 `ai-taught-me/`
2. 按本设计创建 SKILL.md 和 workflows/*.md
3. 删除旧目录 `documenting-to-ai-taught-me/`
4. 更新 skill 注册（如需要）
