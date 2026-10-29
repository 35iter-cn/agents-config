# Task Radar — triage & claim

## Three questions (read-only)

Answer in turn; any failure stops into **Report only**.

### Q1 — 未被占领？

- No assignees, not on projectV2 #1, no open PR or timeline
  `CROSS_REFERENCED_EVENT` targeting it.
- Thread replies contain no "I'll take this" / claimed-elsewhere signal.
- Message @-mentions a different owner for it → treat as claimed; ask Hao
  before proceeding.
- Evidence columns carry the proof; empty assignee alone never proves claimable.

### Q2 — 我们能做？

- GitHub-source candidates may target the frontend checkouts under
  `~/code/magicdoor` (internal-portal, company-portal, vendor-portal,
  magicdoor-cms, frontend-common-module) … and, for **board-external
  `MagicDoorInc/backend` issues**, the backend repo itself (claim path C2).
- Backend/devops/infra-domain candidates outside that set: report归属 only,
  never enqueue (see boundary table).
- Frontend-scope test: UI behavior, routing, data rendering, frontend state.
- Scope specable in one pass; too large → propose splitting before intake.

### Q3 — 值得做？

- Real user impact or a direct lead request; not a duplicate. Quick-search
  Slack/issues/state (`backendKnownCandidates`) for prior reports/entries
  before claiming.

### Decision table

| Q1 | Q2 | Q3 | Action |
|----|----|----|--------|
| ✅ | ✅ | ✅ | **Candidate → 人批** (claim below) |
| ✗  | —  | — | Report only: who claimed it / evidence |
| ✅ | ✗  | — | Report only + one line on where it likely belongs |
| ✅ | ✅ | ✗  | Report only, note why not worth taking |

Report only = no writes anywhere; present the evidence and let Hao decide.
In a loop round even a全绿 candidate stays enqueued + reported: scan never
assigns / 上板 / creates issues.

## Claim — after human approval (loop `go` or manual in-session)

### 候选形态三选一

| 候选形态 | 动作序列 |
|---|---|
| C1 看板上已有任务 | 只改 `Status` → `In Progress - 进行中`；`Priority` 仅按 Hao 指定调 |
| C2 板外 GitHub issue（含 backend 板外 issue） | `gh issue edit --add-assignee @me` → `addProjectV2ItemById` → `Status = Todo - 待办事项` → issue 留一条 claim 评论（谁领的、开始时间） |
| C3 Slack 候选（无 issue） | `gh issue create`（正文 = digest + 源 permalink + 三问结论，直接写，不等人确认）→ 上板（同 C2 后两步）→ 源消息 thread 回 claim 通报 |

- Issue already has an assignee → Q1 fails; report only, never claim.
- Mutation recipes: `graphql-recipes.md`; board add/status option ids are in
  its registry. Backend-claim add+delete round-trip verified 2026-10-13.
- Slack claim reply (C3): same channel, `thread_ts` = source message ts;
  report issue link + board status + likely root cause; @-mention the reporter
  via the `magicdoor-people` skill (People table: Slack ID, DM channel, GitHub handle, audience
  class, language);
  thread reply sends directly (no draft confirmation).
- After claiming: create the topic (`topicbox init`) and write the spec per the
  `using-topicbox` skill; **ends at spec confirmation** —
  never create the plan or write code within intake.

## Boundary table

| 场景 | 行为 |
|---|---|
| backend 仓零新增板外 issue | 候选表标注"backend 源无新候选"，不产生 pending |
| 板外 issue 的 url 已在 `backendKnownCandidates` | 跳过，不重复入队、不重复 DM |
| issue 有 assignee | Q1 失败，只报告（附 assignee 与最后活动日） |
| issue 无 assignee 但有人在实施（无 PR 可查） | 照常入候选；认领靠 claim 评论暴露，事后可撤 |
| 候选指向 backend/devops 之外的域（infra） | 标归属后只报告，不入 pending |
| 手动调用与 loop 轮同时改写 state | 原子替换（tmp + `mv`），后写胜；最坏重复报一条候选 |
| 认领中途失败（403/网络） | `[error]` 写 daily log，pending 保持 open 下轮重试 |
| 贴单条 Slack permalink 要求建任务 | 入口已移除；按增量消息处理或等人工直接给出 issue 链接 |

## State protocol

Read-write `~/.config/agent-intake/state.json` only. Schema keys used here:
`backendKnownCandidates` (source URLs already enqueued), `pending` (loop queue
with 72h expiry), `watermarks` in `channels`. Writes are tmp + `mv` atomic
replace; on write failure log `[error]` and do NOT advance watermarks.