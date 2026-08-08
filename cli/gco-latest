#!/usr/bin/env bash
set -euo pipefail

# Use first arg as target dir, fall back to PWD at invocation
cd "${1:-$(pwd)}"

# --- Step 1: check working tree ---
if output=$(git status --porcelain 2>&1); then
  if [ -n "$output" ]; then
    echo "[FAIL] working tree has uncommitted changes:"
    echo "$output"
    exit 1
  fi
else
  echo "[FAIL] could not read git status: $output"
  exit 1
fi

# --- Step 2: detect remote ---
remote=$(git remote 2>/dev/null || true)
if [ -z "$remote" ]; then
  echo "[FAIL] no git remotes configured"
  exit 1
fi
if echo "$remote" | grep -qx 'origin'; then
  remote=origin
else
  remote=$(echo "$remote" | head -1)
fi
echo "[OK] remote: $remote"

# --- Step 3: detect default branch ---
# Try --symref first (fast, works with real remotes like GitHub)
ref_line=$(git ls-remote --symref "$remote" HEAD 2>/dev/null || true)
branch=$(echo "$ref_line" | grep -o 'refs/heads/[^[:space:]]*' | sed 's|refs/heads/||' || true)
# Fallback: match HEAD commit against branch tips
if [ -z "$branch" ]; then
  head_commit=$(git ls-remote "$remote" HEAD 2>/dev/null | awk '{print $1}' || true)
  if [ -n "$head_commit" ]; then
    branch=$(git ls-remote "$remote" refs/heads/* 2>/dev/null | awk -v h="$head_commit" '$1 == h {sub("refs/heads/", "", $2); print $2; exit}' || true)
  fi
fi
# Fallback: pick the first branch listed
if [ -z "$branch" ]; then
  branch=$(git ls-remote "$remote" refs/heads/* 2>/dev/null | awk '{sub("refs/heads/", "", $2); print $2; exit}' || true)
fi
if [ -z "$branch" ]; then
  echo "[FAIL] could not detect default branch on remote '$remote'"
  exit 1
fi
echo "[OK] default branch: $branch"

# --- Step 4: fetch with retry ---
fetch_err=
for attempt in 1 2 3; do
  if fetch_err=$(git fetch --prune "$remote" 2>&1); then
    fetch_err=
    break
  fi
  sleep $(( (attempt - 1) * 2 ))
done
if [ -n "$fetch_err" ]; then
  echo "[FAIL] fetch failed after 3 attempts. last error:"
  echo "$fetch_err"
  exit 1
fi
echo "[OK] fetch complete"

# --- Step 5: checkout ---
target="$remote/$branch"
if ! checkout_out=$(git checkout "$target" 2>&1); then
  echo "[FAIL] checkout to $target failed (clean tree, probably untracked files in the way):"
  echo "$checkout_out"
  exit 1
fi
echo "[OK] checked out $target"

# --- Step 6: report ---
echo ""
echo "HEAD: $(git log --oneline -1)"
