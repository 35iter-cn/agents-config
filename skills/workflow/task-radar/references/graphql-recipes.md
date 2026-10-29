# Task Radar — GraphQL recipes & registry

All queries work when passed as a one-line `-f query=` string or via
`gh api graphql --input -` with a JSON body `{"query": "...", "variables": {...}}`.
Multiline `-f query=` values are known to be mangled by gh — do not use them.

## Registry (stable IDs)

- Project: `PVT_kwDOB_z4Bc4Aatxq` (org MagicDoorInc, projectV2 #1 "Frontend Tasks")
- Status field: `PVTSSF_lADOB_z4Bc4AatxqzgRJasE`
  - `Potential/Future Tasks` → `4d0717e7`
  - `暂时On Hold` → `976183b8`
  - `Todo - 待办事项` → `f75ad846`
  - `Bugs or Urgent` → `fe2274b0`
  - `In Progress - 进行中` → `47fc9ee4`
  - `Done - 已完成` → `98236657`
- Priority field: `PVTSSF_lADOB_z4Bc4Aatxqzgxt` (P0/P1/P2 single select)

## Scan board (paged, collect all items)

One call per page; loop with `pageInfo.endCursor`.

```graphql
query($cursor: String) {
  organization(login: "MagicDoorInc") {
    projectV2(number: 1) {
      items(first: 100, after: $cursor) {
        pageInfo { endCursor hasNextPage }
        nodes {
          id
          fieldValues(first: 20) { nodes {
            ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldUserValue { users(first: 5) { nodes { login } } field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
          } }
          content {
            ... on Issue { number title state repository { nameWithOwner } updatedAt url }
            ... on PullRequest { number title state repository { nameWithOwner } updatedAt url }
          }
        }
      }
    }
  }
}
```

- Assignee filter is client-side: keep items where any
  `ProjectV2ItemFieldUserValue` matches the login.
- Status/Priority come from field values by field name; `(none)` means unset.

## Scan assigned issues board-wide complement

Not every task lives on the project; catch strays with:

```bash
gh search issues --assignee @me --state open --limit 30 \
  --json repository,number,title,state,updatedAt,url
```

## Update board Status

```graphql
mutation {
  updateProjectV2ItemFieldValue(input: {
    projectId: "PVT_kwDOB_z4Bc4Aatxq",
    itemId: "<PVTI_...>",
    fieldId: "PVTSSF_lADOB_z4Bc4AatxqzgRJasE",
    value: { singleSelectOptionId: "98236657" }
  }) { projectV2Item { id } }
}
```

Verified 2026-10-13 (CP#5375 → Done, CP#5565 → On Hold).

## Add issue to board — verified 2026-10-13

```graphql
query { repository(owner: "MagicDoorInc", name: "backend") { issue(number: 1159) { id } } }
mutation {
  addProjectV2ItemById(input: { projectId: "PVT_kwDOB_z4Bc4Aatxq", contentId: "<issue-node-id>" }) {
    item { id content { ... on Issue { number } } }
  }
}
```

Verified 2026-10-13 with backend#1159: add returned the item id and content,
delete restored the board. The add mutation also proves "issue sync to board".
```graphql
mutation { deleteProjectV2Item(input: { projectId: "PVT_kwDOB_z4Bc4Aatxq", itemId: "<PVTI_...>" }) { deletedItemId } }
```

## Scan sources 1+2 (fetch script)

Board paging, @me strays, backend off-board issues and open-PR matching all run
through one read-only script — never hand-roll these calls:

```bash
skills/workflow/task-radar/scripts/scan-github.sh
```

Writes `$TMPDIR/agent-intake/scan.json` (created if missing, overwritten
each run) and prints that path — pass `-` to get the JSON on stdout instead, or
a path to choose the file. If editing its queries: `gh api graphql --input -` body
must nest cursor variables under `"variables"`; top-level keys are silently
ignored (cursor stalls, infinite pagination), and `as $v |` bindings restore the
original input while a direct pipe keeps the bound expression's output.

## Lookup single task (issue side)

```graphql
query {
  repository(owner: "MagicDoorInc", name: "company-portal") {
    issue(number: 5565) {
      timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], first: 10) {
        nodes { ... on CrossReferencedEvent {
          willCloseTarget
          source { ... on PullRequest { number title state url } ... on Issue { number } }
        } }
      }
    }
  }
}
```

## PR execution state

```bash
gh pr view <N> -R MagicDoorInc/<repo> --json \
  isDraft,reviewDecision,mergeStateStatus,commits,files,updatedAt
```

## Field/option discovery (re-check registry if a mutation misses)

```graphql
query {
  organization(login: "MagicDoorInc") {
    projectV2(number: 1) {
      fields(first: 30) { nodes {
        ... on ProjectV2SingleSelectField { id name options { id name } }
      } }
      id
    }
  }
}
```

## History notes

- 2026-10-13: scan/update/add/delete/cross-ref recipes verified end-to-end on
  the live board (43 assigned items across 176 paged items; 4 mutations incl.
  add+delete round-trip).