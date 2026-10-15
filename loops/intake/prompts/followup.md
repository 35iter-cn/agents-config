# Intake loop — followup 轮（pending 处理，无人在场）

除下列三处外允许写操作：state.json、memory daily log、对 self-DM（D0A4YUFK7FC / state.dm.channelId）发消息。领取候选（go 命中）时额外允许：创建/assign issue、加看板、在**候选源消息的 thread** 内回复。

**本轮所有 self-DM 消息一律以固定前缀 `🤖 intake:` 开头**（self-DM 双方同作者，这是用户辨认 loop 消息的唯一锚点）。

## 步骤

1. 读 state.json（运行实例根目录见 prompt 末尾）。收集 `status === "open"` 的 pending。
2. 对每个 open pending：`dmTs` 为空的项先补发 DM（从 note/source 按 scan 轮步骤 7 的格式组装，含 go/skip 指令行，带 `🤖 intake:` 前缀），发送成功后回填 `dmTs` 并推送 `dm.watermark`，本轮不判定该项；其余项用 `conversations_replies(channel_id=state.dm.channelId, thread_ts=<dmTs>, limit="7d")` 读其 DM thread 的回复。
   协议：`^(go|skip)\s\S*$`（大小写不敏感），末词匹配 pending id（大小写不敏感，允许只回 `go` 一次处理最早 pending）。**扫回复时先排除带 `🤖 intake:` 前缀的消息（必是 loop 自身发出），再判**：语义明确可判（接受/拒绝）即为有效判定——判接受按 `go` 分支、判拒绝按 `skip` 分支，`resolvedBy` 记录消息 ts + 判定依据原文短语；语义模糊则按步骤 3 的回复含糊分支处理。**同一 thread 同一 item 存在多条有效判定时（如先同意后拒绝反悔），以 ts 最大的为准；仅对 status=open 的 item 受理，终局项的任何后续回复一律无视**。
3. 判定分支：
   - **go 命中**：按 task-intake 技能 Phase 3–4 执行：
     a. 候选无 issue 则 `gh issue create`（body = 一段话 digest + permalink + triage 依据；标题一句话英文）——允许直接创建
     b. `gh issue edit --add-assignee @me`
     c. `addProjectV2ItemById` 上 Frontend Tasks 看板，`Status = Todo - 待办事项`（配方：task-radar `references/graphql-recipes.md`）
     d. task-intake Phase 3 第 4 步：候选源是 Slack 消息 → 在**其 thread**（thread_ts = 消息本尊）回复领取通报（issue 链接 + 板上状态；根因尚无，等 spec 阶段）
     e. Phase 4：`topicbox init "<hint>"` → `artifact-create <topic> spec <name>` → 对要读的仓跑 `gco-latest` → 读码定根因（硬性要求）→ 按 spec-writing-guide 写 spec，过 Determinism Gate（含 AC 编号）→ **停在 spec，不建 plan、不 freeze**
     f. `self-DM` 汇报一行：`<id> 已领取 → <issue url> | spec: <路径>`；pending 置 `status:"claimed"`，回填 `issue` 字段
     g. 单个 go 超过 18 分钟仍未完成 e：停在做完的步骤，DM 汇报中断点与原因，pending 置回 `open`（下轮重试）
   - **skip 命中**：pending 置 `status:"skipped"`，self-DM 一行确认。
   - **72h 无回复**（addedAt 距今）：置 `status:"expired"`，self-DM 一行通知。
   - **回复含糊**：如果 DM thread 有新回复但不匹配协议：self-DM 追问一次（"回 `go <id>` 或 `skip <id>`"），该项标记 `nudge:<date>`（状态仍 open）；已有 nudge 记录再遇含糊 → 按 skip 处理并 DM 通知。
4. 写 memory daily log：一行 `followup <id> → <claimed|skipped|expired|nudge|error> <一句话>`。
5. state.json 原子替换写回（同 scan 轮规则），`dm.watermark` 推进到本轮见到的最大 DM ts。

## 语言

DM 与报告用中文；链接、代码、标识符逐字保留。

## 边界

- go 执行链里任何一步失败（建 issue 403 等）：已完成的步骤保留，中断点写 daily log `[error]` + self-DM 通知，pending 保持 open；`state.errors.<id>` 计数，连续 3 次 → 置 `status:"stale"` 停止重试并 DM 报障。
- followup 轮内**不改动** intake 轮产出的 pending 以外的任何 state 字段。
- 队列里 claimed/skipped/expired 项保留 30 天后可由主扫描轮归档清理（简单起见：保留即可，不实现清理）。