#!/usr/bin/env bash
set -euo pipefail

ORG="MagicDoorInc"
BACKEND="$ORG/backend"
STATE_FILE="${TASKRADAR_STATE:-$HOME/.config/taskradar/state.json}"

command -v gh >/dev/null || { echo "gh missing" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq missing" >&2; exit 1; }

BOARD_Q='query($cursor: String) {
  organization(login: "MagicDoorInc") {
    projectV2(number: 1) {
      items(first: 100, after: $cursor) {
        pageInfo { endCursor hasNextPage }
        nodes {
          id
          fieldValues(first: 20) { nodes {
            ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldUserValue { users(first: 5) { nodes { login } } field { ... on ProjectV2FieldCommon { name } } }
          } }
          content {
            ... on Issue { number title state updatedAt url repository { nameWithOwner } }
            ... on PullRequest { number }
          }
        }
      }
    }
  }
}'

tmpd="$(mktemp -d)"
trap 'rm -rf "$tmpd"' EXIT

page="$(jq -n --arg q "$BOARD_Q" '{query: $q, variables: {cursor: null}}' | gh api graphql --input -)"
cursor="$(jq -r '.data.organization.projectV2.items.pageInfo.endCursor // empty' <<<"$page")"
has_next="$(jq -r '.data.organization.projectV2.items.pageInfo.hasNextPage // false' <<<"$page")"
jq -c '.data.organization.projectV2.items.nodes' <<<"$page" >>"$tmpd/pages.jsonl"
while [ "$has_next" = "true" ]; do
  page="$(jq -n --arg q "$BOARD_Q" --arg c "$cursor" '{query: $q, variables: {cursor: $c}}' | gh api graphql --input -)"
  cursor="$(jq -r '.data.organization.projectV2.items.pageInfo.endCursor // empty' <<<"$page")"
  has_next="$(jq -r '.data.organization.projectV2.items.pageInfo.hasNextPage // false' <<<"$page")"
  jq -c '.data.organization.projectV2.items.nodes' <<<"$page" >>"$tmpd/pages.jsonl"
done
[ "$has_next" = "false" ] || { echo "board pagination did not complete" >&2; exit 1; }

gh search issues --owner "$ORG" --assignee @me --state open --limit 300 \
  --json repository,number,title,updatedAt,url >"$tmpd/assigned.json"
gh issue list -R "$BACKEND" --state open --limit 300 \
  --json number,title,assignees,labels,createdAt,updatedAt,url >"$tmpd/bissues.json"
gh pr list -R "$BACKEND" --state open --limit 200 \
  --json number,title,body,url >"$tmpd/prs.json"

known='[]'
[ -r "$STATE_FILE" ] && known="$(jq -c '.backendKnownCandidates // []' "$STATE_FILE")"

json="$(jq -n -c \
  --slurpfile B "$tmpd/pages.jsonl" \
  --slurpfile A "$tmpd/assigned.json" \
  --slurpfile BI "$tmpd/bissues.json" \
  --slurpfile PR "$tmpd/prs.json" \
  --arg org "$ORG" \
  --arg backend "$BACKEND" \
  --argjson known "$known" '
  ($B | add) as $items
  | ($A | add) as $assigned
  | ($BI | add) as $bi
  | ($PR | add) as $prs
  | [ $items[]
      | .content
      | select(.state != null)
      | (if .repository.nameWithOwner | startswith($org + "/")
        then .repository.nameWithOwner | sub("^" + $org + "/"; "")
        else .repository.nameWithOwner end) as $repo
      | "\($repo)#\(.number)"
    ] as $onBoardKeys
  | [ $items[]
      | select(.content.state != null)
      | .fieldValues.nodes as $fv
      | ($fv | map(select(.field.name == "Status") | .name)[0] // "(none)") as $status
      | select($status == "Todo - 待办事项" or $status == "Bugs or Urgent")
      | select(.content.repository.nameWithOwner | startswith($org + "/"))
      | {repo: (.content.repository.nameWithOwner | sub("^" + $org + "/"; "")),
         number: .content.number,
         title: .content.title,
         status: $status,
         assignees: (($fv | map(select(.field.name == "Assignees") | .users.nodes[].login)) | unique),
         updatedAt: .content.updatedAt,
         url: .content.url}
    ] as $current
  | [ $assigned[]
      | (.repository.nameWithOwner | sub("^" + $org + "/"; "")) as $r
      | ($r + "#" + (.number | tostring)) as $k
      | {repo: ($r | sub("^" + $org + "/"; "")),
         number: .number,
         title: .title,
         updatedAt: .updatedAt,
         url: .url,
         onBoard: (($onBoardKeys | index($k)) != null)}
    ] as $assigned
  | [ $bi[]
      | .number as $n
      | .url as $u
      | ("backend#" + ($n | tostring)) as $bkey
      | ($prs
         | map(select((.title + " " + (.body // "")) | test("(^|[^0-9])#" + "\($n)" + "([^0-9]|$)"))))
        as $hits
      | {number: $n,
         title: .title,
         assignees: ([.assignees[].login]),
         labels: [.labels[].name],
         updatedAt: .updatedAt,
         url: $u,
         openPrs: [$hits[] | {number, title}],
         onBoard: (($onBoardKeys | index($bkey)) != null),
         known: (($known | index($u)) != null)}
    ] as $bi
  | {board: {current: $current, assignedOpen: $assigned},
     backendIssues: $bi}
')"

if [ "${1:-}" = "-" ]; then
  printf '%s\n' "$json"
  exit 0
fi

out="${1:-}"
[ -n "$out" ] || out="${TMPDIR:-/tmp}/taskradar-intake/scan.json"
mkdir -p "$(dirname "$out")"
printf '%s\n' "$json" >"$out"
printf '%s\n' "$out"