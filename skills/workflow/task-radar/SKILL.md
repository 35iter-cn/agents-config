---
name: task-radar
description: >-
  Use when scanning, triaging, claiming, or reconciling MagicDoor tasks from
  the GitHub side (Frontend Tasks board, MagicDoorInc/backend issues) or from
  Slack messages. Triggers: 任务扫描, 任务对账, 领任务, 上板, 更新看板, 看板状态,
  stale 任务, assigned issues, board sync, update board status, scan/check/claim
  tasks, reconcile issue/PR status, 扫后端 issue, 消息转任务, 接这个活,
  领这条消息的任务, 自动接需求, claim a Slack message as a task,
  评估这个任务我们能不能做, or a user-pasted Slack message / GitHub issue link.
---

# Task Radar

Manage the MagicDoor task intake lifecycle with ONE skill: scan three sources
read-only, triage candidates, claim after human approval, reconcile board state.
A companion loop (`loops/intake`) is a pure trigger: it calls scan on a timer and
runs the DM go/skip protocol; manual invocations decide on the spot and never go
through pending/DM.

State lives ONLY at `~/.config/taskradar/state.json` (watermarks, known board
issues, `backendKnownCandidates`, pending queue) — shared atomic read-write with
the loop; never write state under `loops/intake/`.

The board (MagicDoorInc projectV2 #1 "Frontend Tasks") is the single source of
task state; issues and pull requests are artifacts attached to board tasks.

## Workflows

| 调用 | 做什么 | 细节 |
|---|---|---|
| `scan` | 只读取数三源，产出带证据列的候选表 | `references/graphql-recipes.md`、`scripts/scan-github.sh`、`references/slack-scan.md` |
| `triage` | 三问：未被占领 / 能做 / 值得做 | `references/triage-and-claim.md` |
| `claim` | 人批后按候选形态三选一落地 | `references/triage-and-claim.md` |
| `reconcile` | 看板状态对账、单任务 lookup | `references/graphql-recipes.md` |

## Hard rules

- `scan` is strictly read-only: gh/GraphQL reads only; writes (assign, board,
  issue create, Slack) happen exclusively in `claim` after human approval.
- 贴单条 Slack permalink 不再是 intake 入口：按增量消息处理，或等人工直接给 issue 链接。
- Backend-domain candidates: report and enqueue only; claim paths C1–C3 (see
  triage/claim reference) apply after approval, never from scan.
- GitHub sources 1+2 (board two columns + assigned strays) fetch through
  `scripts/scan-github.sh` — never hand-roll GraphQL paging (cursor/variables
  gotchas are fixed there). Slack source 3 follows `references/slack-scan.md`.
- Every reported candidate carries five evidence columns: 是否在板上 / assignee /
  最后活动日 / open PR 引用 / labels. Empty assignee alone never proves claimable.

## References

- `references/graphql-recipes.md` — board registry, mutations, lookup, backend
  scan recipe delegating to the fetch script.
- `references/slack-scan.md` — source-3 watermark reading, thread context,
  participant resolution, digest shape.
- `references/triage-and-claim.md` — three questions, decision table, claim
  three-ways (board item / off-board issue / Slack candidate), state protocol.