#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$ROOT/logs"

exec 9>"$ROOT/.lock" || exit 0
flock -n 9 || exit 0

cd ~/code

exec pi --mode json --print "$(cat "$ROOT/prompts/scan.md")" \
  >> "$ROOT/logs/$(date +%F-%H%M).jsonl" 2>&1