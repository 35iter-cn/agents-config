#!/usr/bin/env bash
set -euo pipefail

platform="${1:-}"
if [[ -z "$platform" ]]; then
  echo "usage: relay-upgrade.sh <feishu|slack|telegram>" >&2
  exit 2
fi

state="$HOME/.config/taskradar/relay-$platform.json"
wait_seconds="${RELAY_UPGRADE_WAIT:-0}"
heartbeat_seconds="${RELAY_UPGRADE_HEARTBEAT:-300}"

snapshot() {
  node -e '
    const fs = require("node:fs");
    const active = new Set(["queued", "running", "answered"]);
    let state = {};
    try {
      state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    } catch {
      process.stdout.write("0");
      process.exit(0);
    }
    const ids = Object.entries(state.jobs ?? {})
      .filter(([, job]) => active.has(job.status))
      .map(([id]) => id);
    process.stdout.write(ids.length === 0 ? "0" : `${ids.length} ${ids.join(",")}`);
  ' "$state"
}

if [[ -z "${RELAY_UPGRADE_DETACHED:-}" ]] && grep -q "relay@" /proc/self/cgroup 2>/dev/null; then
  unit="relay-upgrade-$platform"
  self="$(readlink -f "$0")"
  if systemctl --user is-active --quiet "$unit"; then
    echo "relay-upgrade: $unit is already waiting (journalctl --user -u $unit)" >&2
    exit 4
  fi
  echo "relay-upgrade: running inside relay cgroup, moving to $unit so the restart cannot kill me"
  if systemd-run --user --collect --unit="$unit" \
    --description "relay upgrade $platform" \
    --setenv=HOME="$HOME" \
    --setenv=PATH="$PATH" \
    --setenv=RELAY_UPGRADE_DETACHED=1 \
    --setenv=RELAY_UPGRADE_WAIT="$wait_seconds" \
    --setenv=RELAY_UPGRADE_HEARTBEAT="$heartbeat_seconds" \
    /bin/bash "$self" "$platform"; then
    echo "relay-upgrade: detached, follow with journalctl --user -u $unit"
    exit 0
  fi
  echo "relay-upgrade: WARN systemd-run failed, staying in the relay cgroup (the restart may kill me before the health check)" >&2
fi

if [[ "$wait_seconds" == "0" ]]; then
  echo "relay-upgrade: $platform waiting for 0 in-flight jobs (state=$state, no time limit)"
else
  echo "relay-upgrade: $platform waiting for 0 in-flight jobs (state=$state, give up after ${wait_seconds}s without restarting)"
fi

started=$SECONDS
last_line=""
last_beat=$started

while true; do
  read -r pending ids <<< "$(snapshot)"
  if [[ "$pending" == "0" ]]; then
    break
  fi
  line="relay-upgrade: $pending job(s) in flight ($ids), waiting"
  if [[ "$line" != "$last_line" ]] || (( SECONDS - last_beat >= heartbeat_seconds )); then
    echo "$line"
    last_line="$line"
    last_beat=$SECONDS
  fi
  if (( wait_seconds > 0 && SECONDS - started >= wait_seconds )); then
    echo "relay-upgrade: still $pending job(s) in flight after ${wait_seconds}s — NOT restarting, relay left untouched. Check again later or raise RELAY_UPGRADE_WAIT." >&2
    exit 3
  fi
  sleep 10
done

echo "relay-upgrade: 0 in-flight job(s), restarting $platform"
systemctl --user restart "relay@$platform.service"
sleep 10

if systemctl --user is-active --quiet "relay@$platform.service"; then
  echo "relay-upgrade: OK $platform active"
  exit 0
fi

echo "relay-upgrade: FAILED $platform" >&2
journalctl --user -u "relay@$platform.service" -n 30 --no-pager >&2
exit 1
