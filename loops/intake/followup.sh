#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$ROOT/logs"

exec 9>"$ROOT/.lock" || exit 0
flock -n 9 || exit 0

cd ~/code

export PATH="$HOME/.volta/bin:$HOME/.bun/bin:$PATH"
PI="${PI:-$HOME/.bun/bin/pi}"
STATE="${TASKRADAR_STATE:-$HOME/.config/taskradar/state.json}"
PENDING=$(node -e "const s=require('$STATE');process.stdout.write(String((s.pending||[]).filter(p=>p.status==='open'||p.status==='hold').length))")
[ "$PENDING" -gt 0 ] || exit 0

WEBHOOK="${TASKRADAR_WEBHOOK:-$HOME/.config/taskradar/webhook.url}"
[ -r "$WEBHOOK" ] || echo "[warn] webhook url missing: $WEBHOOK" >&2

PROMPT="$(cat "$ROOT/prompts/followup.md")

运行实例根目录（本轮所有读写均以它为准）: $ROOT
外置 state 文件（唯一读写目标）: $STATE
频道 `#agent-intake` = C0C9N6SSH39；webhook URL 文件: $WEBHOOK"
exec "$PI" --mode json --print "$PROMPT" \
  >> "$ROOT/logs/followup-$(date +%F-%H%M).jsonl" 2>&1