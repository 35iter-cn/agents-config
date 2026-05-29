---
date: 2026-05-19
project: agents-for-myself
tags: [gsd, optimization, query-specs, magicdoor-backend-api]
---

# Query Specs — GSD 风格重构设计

## 背景

`query-specs.md` 是 `magicdoor-backend-api` skill 的三个核心 workflow 之一，
负责通过 `@magicdoor/env cache query` 获取 OpenAPI spec 缓存文件路径并搜索内容。

## 问题

1. 文档结构松散，关键信息（参数、依赖、约束）散布在各处
2. agent 执行时绕过 `cache query` 直接读取缓存文件
3. 缺乏显式"门禁"机制——规则是描述性的而不是强制性的
4. 与已使用 GSD 标签的 SKILL.md 风格不一致

## 方案

采用 **GSD XML 风格标签**（方案 A）完整重构：

- `<objective>` — 目标定义
- `<execution_context>` — 依赖的 workflow 声明
- `<context>` — 参数（env/service/spec-name）提前收拢
- `<when_to_use>` — 适用场景
- `<process>` — 执行步骤，Step 2 标记 `[HARD GATE]`
- `<runtime_note>` — 原子操作说明
- `<critical_rules>` — 硬规则（含负向指令 + 双层防护建议）
- `<success_criteria>` — 完成标准

### 关键设计：防绕过机制

双层防护：
1. **Workflow 层**：Step 2 标记 `[HARD GATE]` + `<critical_rules>` 明确禁止直接读文件
2. **SKILL 层**（建议）：在 SKILL.md 的 `<critical_rules>` 中禁止 Read tool 读取 `.json` 缓存文件

## 文件清单

- 修改：`skills/magicdoor-skills/magicdoor-backend-api/workflows/query-specs.md`

## 验收标准

- [ ] 文档使用 GSD XML 风格标签
- [ ] `<execution_context>` 显式声明依赖
- [ ] `<context>` 收拢所有参数
- [ ] `<process>` Step 2 标记 `[HARD GATE]`
- [ ] `<critical_rules>` 包含禁止直接读文件的负向指令
- [ ] 与 SKILL.md 风格一致
