# KANBAN LINK column (E)

E carries **GitHub Projects card links**, one per line — not bare issue URLs, not the board URL.
Format verified against `Hao-2026/04` and `Hao-2026/05`:

```
https://github.com/orgs/MagicDoorInc/projects/<P>/views/1?pane=issue&itemId=<databaseId>&issue=<owner>%7C<repo>%7C<number>
```

`<databaseId>` is `ProjectV2Item.databaseId`; the `PVTI_...` node id does not resolve in the URL.

## Boards

| P | Title | Status field id | Owns |
|---|---|---|---|
| 1 | Frontend Tasks | `PVTSSF_lADOB_z4Bc4AatxqzgRJasE` | company-portal, internal-portal, tenant-portal, vendor-portal, magic-manager, magic-resident, frontend-common-module, frontend-ci, cms, website |
| 2 | Backend Tasks | `PVTSSF_lADOB_z4Bc4AgChZzgVPaR4` | backend (mirrors some frontend items) |
| 19 | Owner Portal | `PVTSSF_lADOB_z4Bc4Bn_InzhmhPoc` | owner-portal and owner-side company-portal items |
| 4 | Internal-Portal | look up before use | internal-portal |

Option ids: `f75ad846` Todo/Backlog, `47fc9ee4` Working/In progress, `98236657` Done, `df73e18b` In review (19), `976183b8` 暂时On Hold (1), `3c93dd6f` On Hold (2). Same ids appear in different fields — always pass the project's own status field id.

Backend issues often sit on both 1 and 2; link the owning board (2) only.

## Link evidence, strongest first

1. `pullRequest.closingIssuesReferences`
2. `issue.timelineItems(itemTypes: [CROSS_REFERENCED_EVENT])` → `source` PullRequest (covers open and merged PRs)
3. `pullRequest.body` matching `Closes|Fixes|Refs #N` in the same repo
4. Unambiguous title match (same repo family, exactly one candidate)

No evidence → leave the cell blank. A blank day is a board gap to report, never to invent.
2026/10 came out at 13 of 24 working days; the rest was refactor, infra and CLI work with no card.

## Reconcile status before writing E

The linked card must already tell the truth.

- issue `CLOSED` while the card is not Done → Done
- merged PR that implements the card and no open PR left → Done
- open PR on a Todo/Backlog card → In progress (Working)
- `暂时On Hold` / `On Hold` → leave alone unless a merged PR fixes exactly the described bug; a partial fix does not count
- never touch items assigned to other people; report every change with its one-line evidence

## Procedure

1. Page every relevant board once: `items(first: 100)` with `databaseId`, Status/Assignees field values, and content `number/title/state/updatedAt`.
2. Take the month's PRs from the sheet's PR LINK column, then resolve PR → card with the evidence ladder above (batch GraphQL, 8–10 aliases per call).
3. Build `day → [cards]`, one link per line, and `set "<E><row>" file` per day — serial, retry on 401 or SSL EOF.
4. Verify with one batch `get` of the full range plus a local diff, then report coverage and every status change.
