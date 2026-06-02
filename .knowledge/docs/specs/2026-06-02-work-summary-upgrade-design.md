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
node work-summary.mjs --start-date 2026-06-02 --end-date 2026-06-02 --pr-state merged
```

- 无 `--mode` 参数，由 AI 在提取阶段将 mode 转为具体的 `start-date`/`end-date`
- `--author` 可选，默认从 `git config --get user.email` 自动解析
- `--pr-state` 可选，默认 `all`（open/merged/closed），可选 `open`/`merged`/`closed`
- 日期使用**本地时区**（`Intl.DateTimeFormat` 或 `new Date().getTimezoneOffset()`），不用 UTC，确保晚间提交不跨日

### 4.2 内部模块

| 模块 | 职责 |
|---|---|
| `parseArgs()` | 解析 `--start-date`, `--end-date`, `--author`（可选，默认 `null`）, `--pr-state`（可选，默认 `all`） |
| `resolveAuthor(cwd)` | `git config --get user.email` + `git config --get user.name` |
| `discoverProjects(cwd)` | 检测当前目录是 git repo 或扫描一级子目录 |
| `fetchCommits(dir, author, start, end)` | 执行 `git log --all --no-merges --format='%as%x09%aE%x09%s'`，在脚本内按 `%as` 字段过滤日期范围，按 email 精确匹配作者 |
| `filterSquashMerge(commits)` | 确定性规则检测 squash-merge commit：主题匹配 `#(\d+)` 且同一 PR 号在早期有非 squash 提交则排除 |
| `checkGhAuth()` | `gh auth status` 检测认证状态，失败则跳过 PR 查询并在 JSON 中记录 `warnings` |
| `queryPRs(dir, author, start, end, prState)` | 单次 `gh pr list --json number,title,state,url,createdAt,mergedAt --limit 100` 批量获取；按 `mergedAt`（默认）或 `createdAt` 过滤 |
| `main()` | 编排各模块，输出 JSON |

### 4.3 JSON 输出结构

```json
{
  "meta": {
    "generatedAt": "2026-06-02T12:00:00+08:00",
    "timezone": "Asia/Shanghai",
    "prState": "all"
  },
  "dateRange": { "start": "2026-06-02", "end": "2026-06-02" },
  "author": {
    "email": "manooog@gmail.com",
    "name": "manooog"
  },
  "warnings": [],
  "projects": [
    {
      "name": "agents-for-myself",
      "dir": "/root/agents-for-myself",
      "errors": [],
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
          "url": "https://github.com/manooog/agents-for-myself/pull/42",
          "mergedAt": "2026-06-02T10:00:00Z"
        }
      ]
    }
  ]
}
```

## 5. 数据流与过滤规则

### 5.1 Commit 过滤

⚠️ **关键约束：** `--after`/`--before` 按 committer date 过滤，与 author date 要求不一致。因此禁用 `--after`/`--before`，统一使用脚本端过滤。

```
输入: git log --all --no-merges --format='%as%x09%aE%x09%s'（无时间范围参数）
  ↓
按 author date（%as）在脚本内过滤: startDate ≤ %as ≤ endDate
  ↓
按 author email 精确匹配（大小写不敏感），如指定 `--author` 则使用指定值，否则用 `user.email`
  ↓
Squash merge 检测（确定性规则 v1）:
  1. 提取 subject 中的 `#(\d+)` 作为 PR 号
  2. 如果一个 commit 的 subject 匹配 `#(\d+)`，且在相同 repo 和相同日期范围内存在
     另一个不是 squash 模式（subject 不含 `#(\d+)` 或未匹配 squash 格式）的 commit，
     则排除该 squash-merge commit
  3. 不满足上述条件时保留该 commit
  ↓
去重: 完全相同的 subject + date 只保留一条
  ↓
输出 JSON commits 数组
```

### 5.2 PR 查询

```
前提: 先执行 checkGhAuth()，认证失败 → 跳过 PR 查询，写入 warnings
  ↓
输入: 对每个 project 执行 gh pr list
  ↓
--author "@me"（CLI 登录用户）或 --search "author:<email>"
  ↓
--state <prState>（从 --pr-state 参数传入，默认 all）
  ↓
--json number,title,state,url,createdAt,mergedAt（单次批量查询，避免 N+1）
  ↓
按 mergedAt（默认）在脚本内过滤日期范围；如 mergedAt 为空则 fallback 到 createdAt
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

按 skill-template 的 7 节重构，与标准保持一致。
> ⚠️ 以下中文占位仅为设计阶段表述参考。最终 `SKILL.md` 须 100% 英文（含触发词表格），遵循仓库 English-only 约定。

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

脚本与 `SKILL.md` 同目录（经 `sync-skills.mjs` 扁平链接到 `~/.claude/skills/work-summary/`）：

```bash
script="$(dirname "$0")/work-summary.mjs"
node "$script" --start-date "$startDate" --end-date "$endDate" [--author "$email"] [--pr-state "$prState"]
```

支持 omp/cursor/opencode 等平台 —— 使用 `SKILL_DIR`、`skill_dir` 或脚本所在目录的相对路径，不依赖 `claude settings get skillRoot`。

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

实施后需执行 `scripts/sync-skills.mjs` 确保 symlink 更新。

## 8. 测试策略

| 类型 | 覆盖内容 | 方法 |
|---|---|---|
| unit test | 日期计算（本地时区）、squash merge 检测（确定性规则）、参数解析（`--start-date`/`--end-date`/`--author`/`--pr-state`） | 纯函数输入/输出断言 |
| integration test | 临时 git 仓库中 `fetchCommits()` 按 author date 过滤 | `git init` + 构造不同日期/作者的 commits |
| mock integration | `queryPRs()` 使用 mock `gh` CLI（`PATH` 覆盖或 shim 脚本） | shim 脚本读 `GH_TOKEN` 环境变量，控制 JSON 输出 |
| snapshot test | JSON 输出结构完整性（`meta`/`warnings`/`errors` 字段存在） | JSON schema 断言 |
