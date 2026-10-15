#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$ROOT/logs"

exec 9>"$ROOT/.lock" || exit 0
flock -n 9 || exit 0

cd ~/code

PI="${PI:-$HOME/.bun/bin/pi}"
PROMPT="$(cat "$ROOT/prompts/scan.md")

运行实例根目录（本轮所有读写均以它为准）: $ROOT"
exec "$PI" --mode json --print "$PROMPT" \
  >> "$ROOT/logs/$(date +%F-%H%M).jsonl" 2>&1