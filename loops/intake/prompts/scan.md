# Intake loop — 主扫描轮（L0 + 候选入队，无人在场）

除下列四处外禁止任何写操作：state.json、memory daily log、对自己（D0A4YUFK7FC self-DM）发 DM、轮次日志。

**绝对禁止**：修改/创建 issue、改看板状态、assign、建 topic/spec、对 #frontend 或任何 thread 发消息。

## 步骤

1. 读 state.json（路径见 prompt 末尾注入的"运行实例根目录"）。`channels.<id>` 是该频道已处理到的最大 message ts；为空则按"最近 24 小时"起扫。
2. Slack #frontend（`C0A51L0GAJ0`）：用 1mcp slack `conversations_history` 增量拉取水位之后的消息。过滤疑似任务信号——bug 报告、需求请求、@ frontend 角色的求助；忽略纯闲聊、部署通知。
3. GitHub：用 task-radar 技能 `references/graphql-recipes.md` 的 board 扫描查询，扫 MagicDoorInc projectV2 #1 的 `Todo - 待办事项` 与 `Bugs or Urgent` 两列，对照 `lastBoardKnownIssues` 找新条目；再跑 `gh search issues --assignee @me --state open` 兜漏网（已 assign 的直接入报告，不重复分析）。
4. 每个新候选按 task-intake 技能 Phase 2 三问 triage（未被占领 / 我们能做 / 值得做）。**任何情况下不进入 Phase 3/4**——领取只发生在 followup 轮收到 `go` 之后。
5. 候选入队：
   - `counter += 1`，id = `YYYYMMDD-<counter>`
   - pending 追加 `{"id","dmTs":null,"source":"<#frontend permalink 或 issue url>","note":"<一句依据>","addedAt":"<ISO>","status":"open"}`
6. 报告写入当日 memory daily log（`memory_write target=daily`），头部一行 `## intake loop <YYYY-MM-DD HH:MM>`：
   - 零新信号：一行 `sweep clean (<inspected> msgs, board unchanged)`，仍推进水位。
   - 有候选：每条一行 `[候选 <id>] 一句依据 — permalink`。
7. 若存在候选且 `dm.channelId` 非空：向 self-DM 发一条汇总（≤6 行）。**消息以固定前缀 `🤖 intake:` 开头——self-DM 双方同作者，前缀是用户区分 loop 消息和他本人消息的唯一锚点，所有 loop 发出的 self-DM 一律携带**：

   ```
   intake loop 发现候选（可回 go/skip）:
   [<id1>] <一句依据>
     <permalink>
   [<id2>] ...
   回复 `go <id>` 我就领取它并建 topic/spec；`skip <id>` 忽略；72h 不回自动过期。
   ```

   记录本条 DM 的 ts 回填到所涉 pending 项的 `dmTs`，并推进 `dm.watermark`。`dm.channelId` 为空时跳过 DM（pending 保持 open，DM 环节后补），不打扰。
8. 更新 state.json：`channels.C0A51L0GAJ0` = 本轮见到的最大 ts；`lastBoardKnownIssues` = 本轮两列全部 issue 编号；`lastBoardScan` = ISO 时间。**写盘前写临时文件再 `mv` 原子替换**。失败/出错时水位可推进但必须把异常写进 daily log。

## 语言

报告与 DM 用中文；消息原文里的链接、代码、标识符逐字保留，不翻译。

## 边界

- 单轮超过 10 分钟未完成步骤 1–4，立即收尾写报告（宁可少报，不可卡死）。
- 检索文件内容/路径只用内置 grep/find 工具，禁止 bash 裸调 grep/rg/ls/find/cat/head/tail/wc/stat——临时 JSONL 的计数/字段提取/截断用 node/python 一步完成，不拆 bash 管道。
- token 失效 / API 报错：daily log 一行 `[error] <来源> <原因>`，正常退出，下轮重试。
- 消息 @ 的处理人不是 frontend、或属 backend/devops 域：`[忽略]`，写一句归属判断。