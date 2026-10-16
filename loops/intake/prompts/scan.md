# Intake loop — 主扫描轮（L0 + 候选入队，无人在场）

除下列四处外禁止任何写操作：外置 state.json（路径见 prompt 末尾注入）、memory daily log、对自己（self-DM）发 DM、轮次日志。

**绝对禁止**：修改/创建 issue、改看板状态、assign、建 topic/spec、对 #frontend 或任何 thread 发消息。

## 步骤

1. 读外置 state.json（`~/.config/taskradar/state.json`）。`channels.<id>` 是该频道已处理到的最大 message ts；为空则按"最近 24 小时"起扫。文件不存在时按 task-radar 技能定义初始化（空 `channels`/`lastBoardKnownIssues`/`backendKnownCandidates`，水位从最近 24h 起；tmp + `mv` 原子写入）。
2. **源 1+2（GitHub）**：运行 task-radar 技能的取数脚本 `scripts/scan-github.sh`（技能路径：`~/.pi/agent/skills/task-radar/`），一次拿到 `board.current`（两列）、`board.assignedOpen`（兜漏）、`backendIssues`（板外比对 + open PR 命中 + known 标记）。
   - `board.current` 与 `lastBoardKnownIssues` 找看板新条目；`assignedOpen` 直接入报告（不重复分析）。
   - 源 2 候选 = `backendIssues` 里 `onBoard=false` 且 `known=false` 的；`onBoard=false` 但 `known=true` 的跳过不重报；`assignees` 非空则不构成可认领候选（入报告并标谁占着）。
   - backend 源零新增 → 报告一行"backend 源无新候选"，不产生 pending；候选指向 backend/devops 之外域（infra）→ 标归属后只报告，不入队。
3. **源 3（Slack）**：`#frontend`（`C0A51L0GAJ0`）按 task-radar `references/slack-scan.md` 水位增量拉取与过滤（bug 报告、需求请求、@ frontend 求助；忽略闲聊、部署通知）。判定"零新消息 = 既有水位即全量结果的 max ts"。
4. 每个新候选按 task-radar `triage` workflow 三问（`references/triage-and-claim.md`：未被占领 / 能做 / 值得做），输出五列证据（是否在板上 / assignee / 最后活动日 / open PR / labels）。**任何情况下不执行 claim**——领取只发生在 followup 轮收到 `go` 之后。
5. 候选入队：
   - `counter += 1`，id = `YYYYMMDD-<counter>`
   - pending 追加 `{"id","dmTs":null,"source":"<#frontend permalink 或 issue url>","note":"<一句依据>","addedAt":"<ISO>","status":"open"}`
   - backend 板外 issue 入队时把其 url 追加进 `backendKnownCandidates`（防重报）。
6. 报告写入当日 memory daily log（`memory_write target=daily`），头部一行 `## intake loop <YYYY-MM-DD HH:MM>`：
   - 零新信号：一行 `sweep clean (<inspected> msgs, board unchanged, backend 无新候选)`，仍推进水位。
   - 有候选：每条一行 `[候选 <id>] 一句依据 — permalink`。
7. 若存在候选且 `dm.channelId` 非空：向 self-DM 发一条汇总（≤6 行）。**消息以固定前缀 `🤖 intake:` 开头**（self-DM 双方同作者，前缀是用户区分 loop 消息的锚点，所有 loop 发出的 self-DM 一律携带）：

   ```
   intake loop 发现候选（可回 go/skip）:
   [<id1>] <一句依据>
     <permalink>
   [<id2>] ...
   回复 `go <id>` 我就领取它并建 topic/spec；`skip <id>` 忽略；72h 不回自动过期。
   ```

   记录本条 DM 的 ts 回填所涉 pending 项的 `dmTs`，并推进 `dm.watermark`。`dm.channelId` 为空时跳过 DM（pending 保持 open，DM 环节后补），不打扰。
8. 更新外置 state.json：`channels.C0A51L0GAJ0` = 本轮见到的最大 ts；`lastBoardKnownIssues` = 本轮看板两列全部 issue 编号；`lastBoardScan` = ISO 时间。**写盘前写临时文件再 `mv` 原子替换**。失败/出错时水位可推进但必须把异常写进 daily log。

## 语言

报告与 DM 用中文；消息原文里的链接、代码、标识符逐字保留，不翻译。

## 边界

- 单轮超过 10 分钟未完成步骤 1–4，立即收尾写报告（宁可少报，不可卡死）。
- 检索文件内容/路径只用内置 grep/find 工具，禁止 bash 裸调 grep/rg/ls/find/cat/head/tail/wc/stat——临时 JSONL 的计数/字段提取/截断用 node/python 一步完成，不拆 bash 管道。
- token 失效 / API 报错：daily log 一行 `[error] <来源> <原因>`，正常退出，下轮重试。
- 消息 @ 的处理人不是 frontend、或属 devops/infra 域：`[忽略]`，写一句归属判断。
- 手动调用 task-radar 技能与本轮共享外置 state：原子替换、后写胜；最坏重复报一条候选。