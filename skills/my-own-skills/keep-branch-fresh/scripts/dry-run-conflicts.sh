#!/usr/bin/env bash
set -euo pipefail

# dry-run-conflicts.sh
# Simulate a rebase of FEATURE_BRANCH onto LMB in an isolated worktree.
# This faithfully reproduces the actual git rebase mechanism (sequential
# cherry-pick of diverged commits) to detect the full conflict surface.
#
# Usage: ./dry-run-conflicts.sh [LMB] [FEATURE_BRANCH]
#   LMB:            Latest main branch ref (default: origin/master, fallback origin/main)
#   FEATURE_BRANCH: Feature branch ref to rebase (default: current HEAD)

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "=== Fetching remote ==="
git fetch origin --prune

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
WORKTREE=$(mktemp -d "/tmp/dry-run-XXXXXX-${BRANCH_NAME//\//-}")

# Resolve LMB to a commit SHA to avoid "branch already checked out" errors
# when the local branch corresponding to LMB is active in another worktree.
LMB_SHA="$(git rev-parse "$LMB")"
MERGE_BASE="$(git merge-base "$LMB_SHA" "$HEAD_SHA")"

cleanup() {
  if [[ -d "$WORKTREE" ]]; then
    git worktree remove "$WORKTREE" --force 2>/dev/null || rm -rf "$WORKTREE"
  fi
}
trap cleanup EXIT

echo "=== Dry-run Config ==="
echo "LMB (latest main):  $LMB -> $LMB_SHA"
echo "Feature branch:     $BRANCH_NAME -> $HEAD_SHA"
echo "Merge base:         $(git rev-parse --short "$MERGE_BASE")"
echo "Diverged commits:   $(git log --oneline "$MERGE_BASE..$HEAD_SHA" | wc -l)"
echo "Worktree:           $WORKTREE"
echo ""

# Create worktree at LMB commit (detached HEAD) to avoid branch-lock collisions
echo "=== Creating isolated worktree ==="
git worktree add --detach "$WORKTREE" "$LMB_SHA" 2>&1 | tail -1
echo ""

# Simulate rebase: apply diverged commits onto LMB, one by one
cd "$WORKTREE"
if git rebase --onto HEAD "$MERGE_BASE" "$HEAD_SHA" &>/dev/null; then
  echo "RESULT: clean"
  echo "No conflicts detected. Safe to rebase directly."
  # Clean up the rebase before exiting
  cd "$REPO_ROOT"
  git -C "$WORKTREE" rebase --abort 2>/dev/null || true
  exit 0
fi

# Conflicts exist — collect details
CONFLICT_FILES=$(git diff --name-only --diff-filter=U | sort || true)
if [[ -z "$CONFLICT_FILES" ]]; then
  # Some rebase conflicts are in the index but not in working tree (e.g. modify/delete)
  CONFLICT_FILES=$(git status --porcelain | grep -E '^(DD|AU|UD|UA|DU|AA|UU)' | awk '{print $2}' | sort || true)
fi
CONFLICT_COUNT=$(echo "$CONFLICT_FILES" | grep -c . || true)

echo "RESULT: conflicts"
echo "Conflicts: $CONFLICT_COUNT files"
echo ""

for f in $CONFLICT_FILES; do
  echo "--- $f ---"
  grep -n -B2 -A2 "<<<<<<<" "$f" 2>/dev/null || echo "  (binary/staged-only conflict - see: git diff on this file)"
  echo ""
done

# Abort the simulated rebase so we don't leave the worktree dirty
cd "$REPO_ROOT"
git -C "$WORKTREE" rebase --abort 2>/dev/null || true
