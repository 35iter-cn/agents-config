# Task Radar — Slack source (watermark scan)

Source 3 of `scan`. The canonical repo loop (`loops/intake/prompts/scan.md`)
owns the watermark; the skill follows the same protocol when invoked manually.
Slack writes are forbidden everywhere except the claim path defined in
`references/triage-and-claim.md` (claim notification reply) — scanning never
sends messages.

## Watermark incremental read

- Read `~/.config/taskradar/state.json` → `channels` map (channel → watermark ts)
  and `lastBoardScan` for cadence context.
- `conversations_history` per tracked channel (currently `#frontend`), 2–4 day
  lookback window: the result includes the watermark's own message, so判定 sweep
  clean 即「结果里最大 ts == 当前水位」，无需重读上轮已入队消息。
- 新于水位的每条消息进候选分析；分析完成后把最大 ts 写回水位（tmp + `mv` 原子替换）。
- Loop-authored DMs carry the `🤖 intake:` prefix; exclude them from reply
  detection when later reading a DM thread (see triage reference).

## Message context (for a candidate under triage)

1. Single message: pass the full URL to `conversations_search_messages` as
   `search_query`.
2. Thread context: `conversations_replies(channel_id, ts)`; for a top-level
   message also pull `conversations_history` (a few days' window).
3. Resolve participants against `using-slack/references/identity.md`; note every
   @-mention and who was addressed first. `@`-addressing a different owner
   counts as claimed evidence for Q1.
4. If the message links a GitHub issue, use the issue itself as the primary
   evidence (board membership, assignees, PRs) instead of re-analyzing the text.

## Evidence columns for Slack candidates

A Slack candidate enters the candidate table with the five shared columns
(是否在板上 / assignee / 最后活动日 / open PR 引用 / labels) plus a digest line:
who reported what, where (channel/thread permalink), evidence links/screencasts,
any linked issue. Empty assignee alone never proves claimable.

## DM go/skip protocol (loop-owned)

When scanning runs inside the loop, triage-passed candidates are enqueued into
`pending` and a DM thread (state `dm.channelId`) alerts Hao with a
`🤖 intake:`-prefixed message; execution stays parked until Hao replies
`go <id>` / `skip <id>` (72h expiry). Manual invocations never enqueue and never
DM — decide in-session (see triage reference).