#!/usr/bin/env bash
set -euo pipefail

# verify-no-conflicts.sh
# Verify that no conflict markers remain and the rebase is in a good state.
# Exit 0 if clean, exit 1 with details if conflict markers found.

echo "=== Checking for remaining conflict markers ==="

# Search for conflict markers in tracked files (excluding lockfiles and binary files)
FILES=$(git grep -l "<<<<<<<" -- . ':!*.lock' ':!pnpm-lock.yaml' ':!package-lock.json' ':!yarn.lock' ':!*.svg' ':!*.png' ':!*.jpg' ':!*.jpeg' ':!*.gif' ':!*.ico' ':!*.woff' ':!*.woff2' ':!*.ttf' ':!*.eot' || true)

if [[ -z "$FILES" ]]; then
  echo "RESULT: clean"
  echo "No conflict markers found."

  # Check if we're in the middle of a rebase
  if [[ -d "$(git rev-parse --git-path rebase-merge 2>/dev/null)" ]] || \
     [[ -d "$(git rev-parse --git-path rebase-apply 2>/dev/null)" ]]; then
    echo ""
    echo "WARNING: Rebase still in progress. Run: git rebase --continue"
    echo "To abort: git rebase --abort"
    exit 1
  fi

  exit 0
fi

CONFLICT_COUNT=$(echo "$FILES" | grep -c . || true)
echo "RESULT: conflicts"
echo "Found conflict markers in $CONFLICT_COUNT file(s):"
echo "$FILES"
echo ""
echo "Locations:"
for f in $FILES; do
  echo "--- $f ---"
  grep -n "<<<<<<<\|=======\|>>>>>>>" "$f" || true
  echo ""
done

exit 1
