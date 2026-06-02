# Work-Summary Skill Upgrade Design

## 1. Overview

将 `work-summary` skill 从 XML-tag 结构重构为 skill-template 7 节结构，并将核心逻辑提取为一个端到端的 Node.js 脚本（`work-summary.mjs`）。脚本从 git 仓库抓取 commits、通过 gh CLI 查询 PRs，输出 JSON 中间格式；AI 消费 JSON 渲染为带 emoji 的 "action + outcome/purpose" Markdown 报告。

## 2. Motivation

现有 SKILL.md 使用非标准的 XML tag 结构（`<when_to_use>`、`<critical_rules>` 等），不符合 skill-template 规范。核心逻辑脚本 `work-summary.mjs` 仅做了日期范围计算 + 项目发现，commit 采集、PR 查询、摘要生成全部由 AI 在 skill 流程中手动执行 bash 命令，步骤繁琐且不可测试。

升级后将：
- **SKILL.md** → 按 7 节模板重构（Overview, When to Use, When NOT to Use, Quick Reference, Core Flow, Common Mistakes, Red Flags）
- **work-summary.mjs** → 端到端数据采集器：日期解析 → 项目发现 → commit 拉取 → PR 查询 → JSON 输出
- **参数提取** → 去掉 `argument-hint`，改为 AI 从用户自然语言中提取（参考 runx skill 模式）
- **输出格式** → 脚本输出 JSON，AI 渲染为 Markdown

## 3. Architecture

```mermaid
flowchart TD
    A([用户输入: "今天做了什么"]) --> B[Skill 解析参数]
    B --> C{提取参数}
    C -->|mode=today| D[node work-summary.mjs --start-date 2026-06-02 --end-date 2026-06-02]
    C -->|mode=week| E[node work-summary.mjs --start-date 2026-05-30 --end-date 2026-06-05]
    C -->|自定义范围| F[node work-summary.mjs --start-date ... --end-date ...]

    D --> G[脚本输出 JSON]
    E --> G
    F --> G

    G --> H[AI 消费 JSON]
    H --> I[按项目分组，语义合并 commits]
    I --> J[渲染 Markdown\n(emoji + action/outcome)]
    J --> K[# PRs 部分]
    K --> L([输出给用户])
```

## 4. 脚本架构 (`work-summary.mjs`)

### 4.1 CLI 接口

```bash
node work-summary.mjs --start-date 2026-06-02 --end-date 2026-06-02
node work-summary.mjs --start-date 2026-06-02 --end-date 2026-06-02 --author user@email.com
```

无 `--mode` 参数，由 AI 在提取阶段将 mode 转为具体的 `start-date`/`end-date`。

### 4.2 内部模块

| 模块 | 职责 |
|---|---|
| `parseArgs()` | 解析 `--start-date`, `--end-date`, `--author`（可选，默认 `null`） |
| `resolveAuthor(cwd)` | `git config --get user.email` + `git config --get user.name` |
| `discoverProjects(cwd)` | 检测当前目录是 git repo 或扫描一级子目录 |
| `fetchCommits(dir, author, start, end)` | `git log` 按 author date 过滤，返回结构化 commit 列表 |
| `filterSquashMerge(commits)` | 启发式检测 squash-merge commit，排除冗余项 |
| `queryPRs(dir, author, start, end)` | `gh pr list` + `gh pr view` 获取 PR 信息 |
| `main()` | 编排各模块，输出 JSON |

### 4.3 JSON 输出结构

```json
{
  "mode": "today",
  "dateRange": { "start": "2026-06-02", "end": "2026-06-02" },
  "author": {
    "email": "manooog@gmail.com",
    "name": "manooog"
  },
  "projects": [
    {
      "name": "agents-for-myself",
      "dir": "/root/agents-for-myself",
      "commits": [
        {
          "date": "2026-06-02",
          "subject": "refactor: rename ship-it to ship-specs, remove brainstorm phase",
          "hash": "5b4f042"
        }
      ],
      "prs": [
        {
          "number": 42,
          "title": "Add X feature",
          "state": "MERGED",
          "url": "https://github.com/manooog/agents-for-myself/pull/42"
        }
      ]
    }
  ]
}
```

## 5. 数据流与过滤规则

### 5.1 Commit 过滤

```
输入: git log --all --no-merges --format='%as%x09%aE%x09%s' --after=<start> --before=<end>
  ↓
按 author email 精确匹配（大小写不敏感）
  ↓
按 author date 范围过滤（%as 格式）
  ↓
Squash merge 检测: 主题含 #123 的 commit，如功能与已有 commit 重叠则排除
  ↓
输出 JSON commits 数组
```

### 5.2 PR 查询

```
输入: 对每个 project 执行 gh pr list
  ↓
--author "@me" 或 --search "author:<email>"
  ↓
--state all（默认 open/merged/closed；用户可通过 $prState 指定筛选）
  ↓
对每个 PR，gh pr view <number> --json title,state,url,createdAt
  ↓
按时间范围过滤 createdAt
  ↓
输出 JSON prs 数组
```

### 5.3 日期范围映射

| 用户输入 | AI 提取 | 传给脚本的参数 |
|---|---|---|
| "今天做了什么" | mode=today | `--start-date 2026-06-02 --end-date 2026-06-02` |
| "这周的工作" | mode=week | `--start-date 2026-05-30 --end-date 2026-06-05` |
| "上周的工作总结" | mode=last-week | `--start-date 2026-05-23 --end-date 2026-05-29` |
| "6月1号到5号的" | mode=custom | `--start-date 2026-06-01 --end-date 2026-06-05` |
| "最近三天" | mode=custom | `--start-date 2026-05-30 --end-date 2026-06-01` |

## 6. SKILL.md 结构

按 skill-template 的 7 节重构，与标准保持一致：

```yaml
---
name: work-summary
description: Generate personal work summary from git commits and related PRs
category: workflow
date_added: "2026-05-29"
---
```

### 6.1 Overview

一句话说明 skill 的用途和产出。

### 6.2 When to Use

触发条件：用户要每日/每周/自定义时间范围的工作总结，需要按项目分组、按作者过滤、附带 PR 链接。

### 6.3 When NOT to Use

不适用的场景：非 git 项目、用户只问 commit 历史不看总结。

### 6.4 Quick Reference

参考 runx 的写法，包含：

**Step 1: Classify Intent and Extract Parameters**

| 参数 | 说明 | 来源 |
|---|---|---|
| `$timeRange` | 时间范围 | 自然语言推断："今天"→today，"这周"→week，"6.1-6.5"→custom |
| `$startDate` | 开始日期 | 根据 `$timeRange` 计算 |
| `$endDate` | 结束日期 | 根据 `$timeRange` 计算 |
| `$author` | Git 作者 | 默认当前用户，可选指定 |
| `$prState` | PR 状态 | 默认 `all`（open/merged/closed），可选 `open`/`merged`/`closed` |

Date Range Inference:

| 触发词 | 逻辑 |
|---|---|
| "今天", "今日", "today" | start = end = 今天 |
| "这周", "本周", "this week" | 最近周六 → 周五 |
| "上周", "last week" | 上周六 → 上周五 |
| "这月", "本月", "this month" | 本月1号 → 今天 |
| "6月1号到5号" | 精确解析日期范围 |
| "最近N天" | 从 N 天前到今天 |

**Step 2: Execute Script**

```bash
script=$(claude settings get skillRoot)/work-summary/work-summary.mjs
node "$script" --start-date "$startDate" --end-date "$endDate" [--author "$email"]
```

**Step 3: Render Summary**

从脚本输出的 JSON 中提取 `projects`，按以下规则渲染：

- 每个 project 一个 `##` 标题
- 每个 project 最多 3 个 commit 项，合并同类主题
- 每个 commit 写成 "emoji + action + outcome/purpose" 格式
- 最后追加 `# PRs` 部分，按 project 分组列出 URL
- 输出纯 Markdown（不再嵌套 code block）

### 6.5 Core Flow

```mermaid
flowchart TD
    A([用户输入]) --> B[Classify Intent\nExtract Parameters]
    B --> C[Execute work-summary.mjs\n获取 commits + PRs JSON]
    C --> D[Render Markdown\n(AI 语义合并 + 格式化)]
    D --> E([输出给用户])
```

### 6.6 Common Mistakes

- 未检测 gh CLI 是否已认证就开始查询 PR
- Squash merge 未被识别，导致重复计数
- 在非 git 目录下未正确扫描子目录

### 6.7 Red Flags

- gh CLI 未登录或认证过期 → 跳过 PR 部分，只输出 commit 总结
- 脚本返回空 projects → 提示 "该时间段没有发现提交记录"
- 在大型 monorepo 中扫描过深

## 7. 文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `skills/magicdoor-skills/work-summary/SKILL.md` | 重构 | 按 7 节模板重写 |
| `skills/magicdoor-skills/work-summary/work-summary.mjs` | 升级 | 端到端数据采集器 |
| `skills/magicdoor-skills/work-summary/work-summary.test.mjs` | 升级 | 适配新 CLI 接口的测试 |
| `skills/magicdoor-skills/work-summary/workflows/` | 新增(可选) | 如果 skill 需要引用外部 step 脚本 |

## 8. 测试策略

- unit test: 日期计算、squash merge 检测、参数解析
- integration test: 在临时 git 仓库中测试 commit 采集 + PR 查询（mock gh CLI）
- snapshot test: JSON 输出结构验证
