# Intake loop — L0 扫描轮

这是定时循环中的一轮，无人在场。除下列三处外禁止任何写操作：state.json 水位、memory daily log、Slack DM（仅当存在候选且 dm 配置有效）。

**绝对禁止**：修改/创建 issue、改看板状态、assign、建 topic/spec、发频道消息或 thread 回复。

## 步骤

1. 读 `~/code/agents-config/loops/intake/state.json`。`channels.<id>` 是该频道已处理到的最大 message ts；为空则按"最近 24 小时"起扫，首轮只观察不动水位之外的东西。
2. Slack #frontend（`C0A51L0GAJ0`）：用 1mcp slack 的 `conversations_history` 增量拉取水位之后的消息。过滤疑似任务信号——bug 报告、需求请求、@ frontend 角色的求助；忽略纯闲聊、部署通知、已有人认领的闲聊。
3. GitHub：用 task-radar 技能 `references/graphql-recipes.md` 里的 board 扫描查询，扫 MagicDoorInc projectV2 #1 的 `Todo - 待办事项` 与 `Bugs or Urgent` 两列，对照 `state.lastBoardKnownIssues` 找新条目；再跑 `gh search issues --assignee @me --state open` 兜漏网（已 assign 的直接入报告，不重复分析）。
4. 每个新候选按 task-intake 技能 Phase 2 三问 triage（未被占领 / 我们能做 / 值得做）出结论。L0 下**任何情况下不进入 Phase 3/4**。
5. 报告写入当日 memory daily log（`memory_write target=daily`），头部一行 `## intake loop <YYYY-MM-DD HH:MM>`：
   - 零新信号：一行 `sweep clean (<inspected> msgs, board unchanged)`，仍要推进水位。
   - 有候选：每条一行 `[候选|忽略] 一句依据 — permalink`。
6. 更新 `state.json`：`channels.C0A51L0GAJ0` = 本轮见到的最大 ts；`lastBoardKnownIssues` = 本轮两列的全部 issue 编号；`lastBoardScan` = ISO 时间。**写盘前先写临时文件再 `mv` 原子替换**。报告写入失败或中途出错时，水位可以推进，但必须把异常写进 daily log。
7. 若存在 `[候选]` 且 `state.json` 的 `dm` 字段是有效 DM/MPIM channel id：用 `conversations_add_message` 发一条汇总（≤5 行，每行一条候选 + permalink）。`dm` 为 null 时跳过，不打扰。

## 语言

报告与 DM 用中文。逐字保留消息原文里的链接、代码、标识符，不翻译。

## 边界

- 单轮若超过 10 分钟仍未完成步骤 1–4，立即收尾写报告（宁可少报，不可卡死）。
- 检索文件内容/路径只用内置 grep/find 工具，禁止在 bash 里裸调 grep/rg/ls/find/cat/head/tail/wc/stat——临时 JSONL 的计数/字段提取/截断用 node/python 一步完成，不拆 bash 管道。
- token 失效 / API 报错：写 daily log 一行 `[error] <来源> <原因>`，正常退出（exit 0），下轮重试。
- 频道消息 @ 的处理人不是 frontend、或信号属于 backend/devops 域：直接归 `[忽略]`，只写一句归属判断。