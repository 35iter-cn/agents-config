---
name: task-radar
description: >-
  Manage the personal GitHub task lifecycle on the MagicDoorInc org project board
  (Frontend Tasks, projectV2 #1). The board is the single source of task state;
  issues and pull requests are artifacts attached to board tasks. Use when the
  user mentions 任务扫描, 任务对账, 领任务, 上板, 更新看板, 看板状态, stale 任务,
  assigned issues, board sync, update board status, or asks to scan/check/claim
  tasks, or to reconcile issue/PR status against the board.
---

# Task Radar

## Model

- **Board** = single source of task state. MagicDoorInc org `projectV2` number 1
  ("Frontend Tasks"), 176+ items, assignee-filtered via `ProjectV2ItemFieldUserValue`.
- **Issue** = the task's factual source attached to a board item (the "paper trail").
- **PR** = progress evidence attached via cross-reference (PR body containing
  `Fixes #N` auto-creates the association — never hand-maintain links).

## Lifecycle

1. **Create task**: open an issue, then add it to the board
   (`addProjectV2ItemById`). Task now exists as a board item ("领任务 / 上板").
2. **Track progress**: board item `Status` field is updated directly on the board
   (`updateProjectV2ItemFieldValue`). GitHub issue state is secondary.
3. **PR stage**: the PR body must reference the issue (`Fixes #N`). This creates
   a timeline `CrossReferencedEvent` with `willCloseTarget`, visible from the
   board item's issue.
4. **Closure**: PR merges → issue auto-closes → set board `Status` to Done.
   Closing on GitHub alone does NOT move the board column.

## Hard rules

- **Shared team board**: never batch-change statuses without a user-confirmed
  per-item mapping. Present an evidence table (item / current status / evidence /
  suggestion) and let the user decide.
- **gh GraphQL**: always send `-f query` as a single line, or use `--input`
  with a JSON body. Multiline `-f query=` values get mangled by gh and fail to parse.
- **IDs**: project/field/option IDs live in
  `references/graphql-recipes.md` (registry section). Re-check there first; they
  are stable per project and field, not per session.
- **Pagination**: board scans are paged (100 per page, `pageInfo.endCursor` loop).
  Filtered counts (assignee) are computed client-side after collecting all pages.
- **Verification before writing**: status updates must be backed by evidence —
  issue activity dates, open/closed PRs with their draft/review/merge state, or
  repo code inspection. A bare issue `updatedAt` does not prove board correctness.

## Workflows

### Scan / audit ("对账")

1. Page through board items, collect items assigned to user (Status + Priority + item id).
2. Cross against `gh search issues --assignee @me` (catches tasks not on the board)
   and open/draft PR state (`reviewDecision`, `mergeStateStatus`, `isDraft`).
3. Flag stale items: e.g. `In Progress` with no associated PR and no issue movement
   for 5+ weeks, or issues closed while board shows non-Done.
4. Report; user confirms changes; apply mutations one mutation call per item.

### Update status

Requires: board item id (from scan or lookup) + target option id. Single
`updateProjectV2ItemFieldValue` mutation per item. See recipes.

### Add issue to board

`addProjectV2ItemById` with projectId + the issue's node id
(fetch via `repository(owner:name){issue(number:){id}}`).
Marked UNVERIFIED in recipes — smoke-test on a disposable item before relying on
it in a real run; remove the test item with `deleteProjectV2Item` afterwards.

### Lookup single task

Given issue/PR number: check board presence/Status, its cross-referenced PRs
(`timelineItems(CROSS_REFERENCED_EVENT)`), and PR execution state
(draft/approved/mergeable). Answers "what's the real status of this task and
what is missing to close it".