#!/usr/bin/env bash
set -euo pipefail

# dry-run-conflicts.sh
# Perform an isolated merge dry-run to discover the full conflict surface
# between a feature branch and the latest main branch.
#
# Usage: ./dry-run-conflicts.sh [LMB] [FEATURE_BRANCH]
#   LMB:            Latest main branch ref (default: origin/master, fallback origin/main)
#   FEATURE_BRANCH: Feature branch ref to merge (default: current HEAD)

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

git fetch origin

# Resolve LMB
LMB="${1:-}"
if [[ -z "$LMB" ]]; then
  if git rev-parse --verify origin/master &>/dev/null; then
    LMB="origin/master"
  elif git rev-parse --verify origin/main &>/dev/null; then
    LMB="origin/main"
  else
    echo "ERROR: Could not infer main branch. Neither origin/master nor origin/main exists." >&2
    exit 1
  fi
fi

FEATURE_BRANCH="${2:-HEAD}"
HEAD_SHA="$(git rev-parse "$FEATURE_BRANCH")"
BRANCH_NAME="$(git rev-parse --abbrev-ref "$FEATURE_BRANCH")"
WORKTREE="/tmp/dry-run-$(date +%s)-${BRANCH_NAME//\//-}"

# Resolve LMB to a commit SHA to avoid "branch already checked out" errors
# when the local branch corresponding to LMB is active in another worktree.
LMB_SHA="$(git rev-parse "$LMB")"

cleanup() {
  if [[ -d "$WORKTREE" ]]; then
    git worktree remove "$WORKTREE" --force 2>/dev/null || rm -rf "$WORKTREE"
  fi
}
trap cleanup EXIT

echo "=== Dry-run Config ==="
echo "LMB:            $LMB ($LMB_SHA)"
echo "Feature branch: $BRANCH_NAME ($HEAD_SHA)"
echo "Worktree:       $WORKTREE"
echo ""

# Create worktree at LMB commit (detached HEAD) to avoid branch-lock collisions
git worktree add "$WORKTREE" "$LMB_SHA"

# Perform dry-run merge
cd "$WORKTREE"
if git merge --no-commit --no-ff "$HEAD_SHA" &>/dev/null; then
  echo "RESULT: clean"
  echo "No conflicts detected. Safe to rebase directly."
  exit 0
fi

# Conflicts exist — collect details
CONFLICT_FILES=$(git diff --name-only --diff-filter=U | sort)
CONFLICT_COUNT=$(echo "$CONFLICT_FILES" | grep -c . || true)

echo "RESULT: conflicts"
echo "Conflicts: $CONFLICT_COUNT files"
echo ""

for f in $CONFLICT_FILES; do
  echo "--- $f ---"
  # Extract conflict markers with surrounding context (5 lines before/after)
  grep -n -B2 -A2 "<<<<<<<" "$f" || true
  echo ""
done
