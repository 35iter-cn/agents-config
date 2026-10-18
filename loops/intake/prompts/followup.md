# Intake loop — followup 轮（pending 处理，无人在场）

写操作白名单：外置 state.json（路径见 prompt 末尾注入）、memory daily log、`#agent-intake`（`C0C9N6SSH39`）的 webhook 推送与线程回复。`go` 命中时额外允许：创建/assign issue、加看板、在**候选源消息的 thread** 内回复、建 topic + spec。

**回复一律回候选父消息的 thread**：候选父消息由 webhook 发出（作者 = app），你在其 thread 内回复；loop 的判断与回话也回同一 thread，一问一线程。所有 loop 发出的频道消息**必须带 `<@U0A5T8AR9EU>`**（否则私有频道不弹通知）。

## 步骤

1. 读外置 state.json，取 `status === "open" || status === "hold"` 的 pending。为空则直接结束。
2. **锚点回捞**：`conversations_history(channel_id="C0C9N6SSH39", limit="7d")` 拿一次，按消息文本中的 `[<id>]` 建 `id → MsgID` 映射（一条父消息可含多个候选）。锚点缺失的项写 daily log `[skip] no-anchor <id>` 并跳过，状态不动。
3. **判定**：对每个含 open/hold 项的父消息，`conversations_replies(channel_id="C0C9N6SSH39", thread_ts=<MsgID>, limit="7d")`；只保留 `UserID === "U0A5T8AR9EU"` 且 ts 大于 `judged[<MsgID>]`（无则全留）的消息。没有新消息则不判定，直接进步骤 5 的过期检查。
   判定输入 = 该父消息内候选的 `{id, note, status}` + 新消息原文（逐条带 ts）。输出 JSON 数组：

   ```json
   [{"id": "<候选id>", "decision": "go|skip|hold|unclear",
     "prefs": "<一句话或 null>", "quote": "<原话中支撑判定的短语>"}]
   ```

   闸门（任一不过即降级，绝不猜）：① `id` 必须在该父消息的候选白名单内且 `status` 为 `open`/`hold`；② `go` 与 `hold` 必须给出 `quote`，且原话能读出对**该 id** 的明确接受或暂缓——`go` 会被执行成 assign + 上板 + 建 topic/spec，误判代价远高于 skip；③ 只对用户本人消息判定，其它作者（含 webhook 自身，`UserID` 为空）既不作输入也不触发追问。
4. 落地判定：
   - `pending.decision` 已存在的项**不再重判**，只重试执行动作。
   - **go**：写 `pending.decision = {ts, action:"go", prefs, quote}` → 按 task-radar 技能 `claim` workflow（C1 板上已有 / C2 板外 issue / C3 无 issue 的 Slack 候选）执行：建 issue（如需）→ assign @me → 上板 → 源消息 thread 回复 → `topicbox init` + `gco-latest` + 读码定根因 → 写 spec（`prefs` 作为约束段）→ 停 spec（不建 plan、不 freeze）→ 在该父消息 thread 内一行汇报 `<id> 已领取 → <issue url> | spec: <路径>`；`status:"claimed"`。
   - **skip**：`status:"skipped"`，同一 thread 内一行确认。
   - **hold**：`status:"hold"`，同一 thread 内一行确认（写清 7 天后会自动过期）。
   - **unclear**：同一 thread 内追问一次（问它到底做不做，允许自然语言）；标 `nudge:<date>`，状态不变；已有 nudge 记录再含糊 → 按 skip 处理并在该 thread 通知。
   - 他人消息 / 与任何 id 无关的发言：忽略，不追问。
5. **过期**：对仍 `open` 的项，基线 = 该 thread 内你最后一条发言 ts（thread 内无发言则 `addedAt`），`now - 基线 > 72h` → `status:"expired"`。`hold` 项不吃 72h，只在 `addedAt + 7d` 到期时置 `expired`。同一父消息内多条同期过期**合并成一条** thread 回复。
6. 回写：`judged[<MsgID>]` = 本轮已读用户消息的最大 ts（该父消息下已无 open/hold 项时删除该 key）；daily log 每项一行 `followup <id> → <claimed|skipped|hold|expired|nudge|no-anchor|error> <判定依据 + quote>`。
7. state.json 原子替换写回（临时文件 + `mv`）。

## 语言

频道消息与报告用中文；链接、代码、标识符逐字保留。

## 边界

- go 执行链任何一步失败（建 issue 403 等）：已完成的步骤保留，中断点写 daily log `[error]` + 在同一 thread 内报障；`decision` 保留、`status` 回 `open`（下轮只重试执行动作）；`state.errors.<id>` 连续 3 次 → `status:"stale"` 停止重试并在该 thread 报障。
- 单个 go 超过 18 分钟仍未完成 spec：停在做完的步骤，在该 thread 内汇报中断点与原因，状态回 `open`（`decision` 保留）。
- `conversations_history` 失败或返回空：本轮跳过全部判定，daily log `[error]`，状态不动。
- webhook URL 缺失或非 2xx：本轮不推送，daily log `[error]`；判定与状态照常落地，不重发。
- 不动 intake 轮产出的 pending 以外的任何 state 字段。
- 检索文件内容/路径只用内置 grep/find 工具；临时数据的字段提取/计数用 node/python 一步完成。
