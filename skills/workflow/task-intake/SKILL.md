---
name: task-intake
description: >
  Intake a task from a Slack message or GitHub issue: read the message with context,
  triage feasibility and ownership, and — if MagicDoor frontend can do it and nobody
  has claimed it — claim it (assign + board), create a session topic, and write the
  spec. Ends at the spec; plan and implementation need explicit asks. Triggers:
  给这条消息建任务, 消息转任务, 接这个活, 领这条消息的任务, 自动接需求, claim/receive a
  Slack message as a task, 评估这个任务我们能不能做, or pasting a Slack message
  permalink / GitHub issue link asking to triage or claim it.
---

# Task Intake

Turn a Slack message (or GitHub issue) into a claimed, speced task on the Frontend Tasks board.
The skill **ends at spec confirmation** — never create a plan or write code as part of intake.

Delegation rule: message reading and any Slack replies → `using-slack` skill; board mutations and
lifecycle rules → `task-radar` skill; topic/spec creation → `using-topicbox` skill. This skill only
orchestrates and decides; do not duplicate their recipes here.

## Phase 0 — Parse input

Accept any of: Slack permalink (`…/archives/<C…>/p<ts>`), GitHub issue URL, or quoted message text.
From a permalink, derive `channel_id` and `ts` (`p1792032442775869` → `1792032442.775869`).

## Phase 1 — Read with context

1. Single message: pass the full URL to `conversations_search_messages` as `search_query`.
2. Thread context: `conversations_replies(channel_id, ts)`; if it is a top-level message, also pull
   `conversations_history` (a few days' window) for surrounding channel context.
3. Resolve participants against `using-slack/references/identity.md`; note every @-mention and who
   was addressed first.
4. If the message links a GitHub issue: `gh issue view <N> -R MagicDoorInc/<repo> --json` for body,
   assignees, state, cross-referenced PRs.

Deliverable: a context digest — who reported what, where, evidence (links/screencasts), and any
linked issue. Show it to Hao before triaging.

## Phase 2 — Triage (read-only; no Slack/issue/board writes yet)

Answer three questions in turn; any failure stops into **Report only**.

### Q1 — 未被占领？

- Issue (or implied issue) has **no assignees**, is **not on projectV2 #1**, and has no open PR or
  timeline `CROSS_REFERENCED_EVENT` targeting it.
- Thread replies contain no "I'll take this" / claimed-elsewhere signal.
- Message @-mentions a different owner for it (e.g. @-named person, not the on-call frontend) →
  treat as claimed; ask Hao before proceeding.

### Q2 — 我们能做？

- Repo is one of our frontend checkouts under `~/code/magicdoor` (internal-portal, company-portal,
  vendor-portal, magicdoor-cms, frontend-common-module, …). Backend / DevOps / infra tasks are out.
- The problem is frontend-scope: UI behavior, routing, data rendering, frontend state. A bug whose
  evidence points server-side is out.
- Scope is specable in one pass. Too large → propose splitting before intake.

### Q3 — 值得做？

- Real user impact or a direct request from a lead; not a duplicate. Quick-search Slack/issues for
  existing reports before claiming.

**Decision table**

| Q1 | Q2 | Q3 | Action |
|----|----|----|--------|
| ✅ | ✅ | ✅ | **Claim** (Phase 3) |
| ✗  | —  | — | Report only: who claimed it / evidence |
| ✅ | ✗  | — | Report only + one line on where it likely belongs (which team/repo) |
| ✅ | ✅ | ✗  | Report only, note why not worth taking |

Report only = no writes anywhere; present the evidence and let Hao decide.

## Phase 3 — Claim (all checks passed)

1. `gh issue edit <N> -R MagicDoorInc/<repo> --add-assignee @me`
2. Add to board Frontend Tasks (`projectV2` #1) and set `Status = Todo - 待办事项`; use
   `Bugs or Urgent` instead only when Hao asks. Exact recipes live in `task-radar/references/graphql-recipes.md`.
3. If there is no issue yet (message-only report), open one first (`gh issue create`) with the
   digest + links, then steps 1–2. Draft the issue body in show-to-Hao-first mode.
4. If the intake source is a Slack message, reply in its thread (same channel, `thread_ts` =
   source message ts): report that the task is claimed — issue link, board status, and the likely
   root cause when code reading turned one up. @-mention the reporter with their `<@U…>` ID from
   `using-slack/references/identity.md`, and follow the using-slack language/audience rules. A
   reply inside an existing thread sends directly (no draft confirmation). When triage stops
   without claiming (report only), send no reply by default.
5. Confirm to Hao what was claimed (issue URL, board item, Slack reply permalink).

## Phase 4 — Topic + spec

1. `topicbox init "<topic hint>"` → `artifact-create <topic> spec <name>`.
2. `gco-latest` every repo you are about to read (once per repo). Never in worktrees.
3. Read the actual code touched; identify the root cause concretely (file → component → line-level
   mechanism). Root cause is mandatory, not optional, before writing the spec.
4. Write the spec following `using-topicbox/references/spec-writing-guide.md`: problem statement,
   goal, implementation plan (scope / flow diagram / key code / boundary table), `AC-1…` acceptance
   criteria, risks, out of scope. Run the Determinism Gate — no TBD.
5. **Stop.** Present the spec summary to Hao. The plan is created only on an explicit follow-up ask.

## Output shape

End the intake with one compact block: message digest / triage verdict (Q1–Q3 with evidence) /
claim result (issue + board) / topic + spec path / next-step options (建 plan / 回 Slack / 放着).