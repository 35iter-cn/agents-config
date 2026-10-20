# Intake loop — 主扫描轮（只读取数 + 候选推送）

写操作仅限四处：外置 state.json（路径见 prompt 末尾注入）、memory daily log、向 `#agent-intake`（`C0C9N6SSH39`）的 webhook 推送、轮次日志。

运行实例根目录（prompt 末尾注入的那个目录）**只读**：只用来读本提示词与 `scripts/`，禁止在其下创建、修改、删除任何文件或目录（含 `.tmp/`、`.cache/`）。扫描脚本的原始输出等中间产物一律写到系统临时目录里的固定子目录，每轮覆盖、不做清理：

```bash
OUT="${TMPDIR:-/tmp}/taskradar-intake"
mkdir -p "$OUT"
bash ~/.pi/agent/skills/task-radar/scripts/scan-github.sh > "$OUT/scan.json" 2> "$OUT/scan.err"
```

**绝对禁止**：修改/创建 issue、改看板状态、assign、建 topic/spec、对 #frontend 或任何 thread 发消息、claim。

## 步骤

1. 读外置 state.json（`~/.config/taskradar/state.json`）。只有四个字段：`channels`（频道 → 已处理到的最大 message ts）、`lastBoardKnownIssues`（看板两列上一轮的 issue 编号）、`lastBoardScan`（上一轮扫描的 ISO 时间）、`backendKnownCandidates`（已报过的板外 issue url）。文件不存在时按空对象初始化（`channels` 从"最近 24 小时"起扫）。
2. **源 1+2（GitHub）**：运行 task-radar 技能的取数脚本 `scripts/scan-github.sh`（技能路径：`~/.pi/agent/skills/task-radar/`），一次拿到 `board.current`（两列）、`board.assignedOpen`（兜漏）、`backendIssues`（板外比对 + open PR 命中 + known 标记）。
   - `board.current` 与 `lastBoardKnownIssues` 找看板新条目；`assignedOpen` 里 `updatedAt` 晚于 `lastBoardScan` 的直接入报告（不重复分析）。
   - 源 2 候选 = `backendIssues` 里 `onBoard=false` 且 `known=false` 的；`onBoard=false` 但 `known=true` 的跳过不重报；`assignees` 非空则不构成可认领候选（入报告并标谁占着）。
   - backend 源零新增 → 报告一行"backend 源无新候选"。候选指向 backend/devops 之外域（infra）→ 标归属后只报告，不推送。
3. **源 3（Slack）**：`#frontend`（`C0A51L0GAJ0`）按 task-radar `references/slack-scan.md` 水位增量拉取与过滤（bug 报告、需求请求、@ frontend 求助；忽略闲聊、部署通知）。判定"零新消息 = 既有水位即全量结果的 max ts"。
4. 每个新候选按 task-radar `triage` workflow 三问（`references/triage-and-claim.md`：未被占领 / 能做 / 值得做），输出五列证据（是否在板上 / assignee / 最后活动日 / open PR / labels）。**不执行 claim**——领取只发生在 thread session 收到用户表态之后。
5. 候选编号：本轮内 `YYYYMMDD-HHMM-<n>`（`n` 从 1 递增，`HHMM` 取本轮开始时间）。**不写任何台账**：候选的 id、一句依据、五列证据、permalink 全部只出现在频道消息里，thread 就是它的上下文。
6. 报告写入当日 memory daily log（`memory_write target=daily`），头部一行 `## intake loop <YYYY-MM-DD HH:MM>`：
   - 零新信号：一行 `sweep clean (<inspected> msgs, board unchanged, backend 无新候选)`，仍推进水位。
   - 有候选：每条一行 `[候选 <id>] 一句依据 — permalink`。
7. 若存在候选：**一轮只发一条父消息**到 `#agent-intake`（`C0C9N6SSH39`），内含本轮全部候选。用 webhook 发，URL 从 `~/.config/taskradar/webhook.url` 读（勿打印到日志）：

   ```bash
   curl -sS -X POST -H 'Content-type: application/json' \
     --data "$(node -e 'process.stdout.write(JSON.stringify({text:process.argv[1]}))' "<payload>")" \
     "$(cat ~/.config/taskradar/webhook.url)"
   ```

   `text` 形如（**mention 与 `[<id>]` 都是硬要求**：mention 保证私有频道弹通知，`[<id>]` 供 thread session 引用）：

   ```
   <@U0A5T8AR9EU> intake loop 发现 <N> 个候选（在该消息的 thread 内回复，自然语言也行）
   [<id1>] <一句依据>
     <permalink>
   [<id2>] <一句依据>
     <permalink>
   ```

   一条消息装全部候选，不要拆成多条。webhook 失败（URL 缺失/非 2xx）时降级：daily log 一行 `[error] webhook <原因>`，本轮不重试。发送后**不回写任何 ts**。
8. 更新外置 state.json：`channels.C0A51L0GAJ0` = 本轮见到的最大 ts；`lastBoardKnownIssues` = 本轮看板两列全部 issue 编号；`lastBoardScan` = 本轮 ISO 时间；报过的板外 issue url 追加进 `backendKnownCandidates`。**只允许「脚本内 read → 改这几个键 → tmp + mv」一步完成**（node/python 一行式），**禁止用 write 工具把整份快照盖回去**。临时文件必须与 state.json **同目录**（`mv` 才是原子 rename，跨文件系统会退化成拷贝），不得写到运行实例根目录。失败/出错时水位可推进但必须把异常写进 daily log。

## 语言

报告与频道消息用中文；消息原文里的链接、代码、标识符逐字保留，不翻译。

## 边界

- 单轮超过 10 分钟未完成步骤 1–4，立即收尾写报告（宁可少报，不可卡死）。
- 检索文件内容/路径只用内置 grep/find 工具，禁止 bash 裸调 grep/rg/ls/find/cat/head/tail/wc/stat——临时 JSONL 的计数/字段提取/截断用 node/python 一步完成，不拆 bash 管道。
- 任何写入落在运行实例根目录下（含 `.tmp/`、`.cache/`）都算违规：立即删除，并在 daily log 记一行 `[error] stray write <path>`。
- token 失效 / API 报错：daily log 一行 `[error] <来源> <原因>`，正常退出，下轮重试。
- 消息 @ 的处理人不是 frontend、或属 devops/infra 域：`[忽略]`，写一句归属判断。
- 手动调用 task-radar 技能与本轮共享外置 state：同样只走「读 → 改单键 → tmp + mv」，后写胜，最坏重复报一条候选。
