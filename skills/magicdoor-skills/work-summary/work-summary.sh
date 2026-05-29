#!/bin/sh

set -eu

MODE=today

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)
      [ "$#" -ge 2 ] || {
        echo "Missing value for --mode" >&2
        exit 1
      }
      MODE=$2
      shift 2
      ;;
    --mode=*)
      MODE=${1#--mode=}
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

case "$MODE" in
  today|week) ;;
  *)
    echo "Unsupported mode: $MODE" >&2
    exit 1
    ;;
esac

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN=python
else
  echo "python3 or python is required" >&2
  exit 1
fi

date_output=$(
  "$PYTHON_BIN" - "$MODE" <<'PY'
from datetime import date, timedelta
import sys

mode = sys.argv[1]
today = date.today()

if mode == "today":
    print(today.isoformat())
    print(today.isoformat())
elif mode == "week":
    days_since_saturday = (today.weekday() - 5) % 7
    start_date = today - timedelta(days=days_since_saturday)
    end_date = start_date + timedelta(days=6)
    print(start_date.isoformat())
    print(end_date.isoformat())
else:
    raise SystemExit(f"Unsupported mode: {mode}")
PY
)

START_DATE=$(printf '%s\n' "$date_output" | sed -n '1p')
END_DATE=$(printf '%s\n' "$date_output" | sed -n '2p')

printf 'MODE=%s\n' "$MODE"
printf 'START_DATE=%s\n' "$START_DATE"
printf 'END_DATE=%s\n' "$END_DATE"

current_repo=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$current_repo" ]; then
  printf 'IS_GIT=true\n'
  printf 'PROJECT_COUNT=1\n'
  printf 'PROJECT_1_NAME=%s\n' "$(basename "$current_repo")"
  printf 'PROJECT_1_DIR=%s\n' "$current_repo"
  exit 0
fi

project_count=0
project_file=$(mktemp)
trap 'rm -f "$project_file"' EXIT HUP INT TERM
for candidate in ./*; do
  [ -d "$candidate" ] || continue
  repo_root=$(git -C "$candidate" rev-parse --show-toplevel 2>/dev/null || true)
  [ -n "$repo_root" ] || continue

  candidate_dir=$(cd "$candidate" && pwd -P)
  repo_dir=$(cd "$repo_root" && pwd -P)
  [ "$candidate_dir" = "$repo_dir" ] || continue

  project_count=$((project_count + 1))
  printf 'PROJECT_%s_NAME=%s\nPROJECT_%s_DIR=%s\n' "$project_count" "$(basename "$repo_dir")" "$project_count" "$repo_dir" >>"$project_file"
done

printf 'IS_GIT=false\n'
printf 'PROJECT_COUNT=%s\n' "$project_count"
if [ "$project_count" -gt 0 ]; then
  while IFS= read -r line; do
    printf '%s\n' "$line"
  done <"$project_file"
fi
