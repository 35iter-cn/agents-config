#!/usr/bin/env bash
set -euo pipefail

platform="${1:-}"
if [[ -z "$platform" ]]; then
  echo "usage: relay-upgrade.sh <feishu|slack|telegram>" >&2
  exit 2
fi

state="$HOME/.config/taskradar/relay-$platform.json"
wait_seconds="${RELAY_UPGRADE_WAIT:-1200}"

count_in_flight() {
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const active = new Set(["queued", "running", "answered"]);
    let state = {};
    try {
      state = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      process.stdout.write("0");
      process.exit(0);
    }
    const jobs = Object.values(state.jobs ?? {});
    process.stdout.write(String(jobs.filter((job) => active.has(job.status)).length));
  ' "$state"
}

echo "relay-upgrade: $platform (state=$state, wait<=${wait_seconds}s)"
deadline=$(( SECONDS + wait_seconds ))
while (( SECONDS < deadline )); do
  pending="$(count_in_flight)"
  if [[ "$pending" == "0" ]]; then
    break
  fi
  echo "relay-upgrade: $pending job(s) in flight, waiting"
  sleep 10
done

pending="$(count_in_flight)"
if [[ "$pending" != "0" ]]; then
  echo "relay-upgrade: still $pending job(s) in flight after ${wait_seconds}s, restarting anyway (they will be reported as interrupted)" >&2
fi

systemctl --user restart "relay@$platform.service"
sleep 10

if systemctl --user is-active --quiet "relay@$platform.service"; then
  echo "relay-upgrade: OK $platform active"
  exit 0
fi

echo "relay-upgrade: FAILED $platform" >&2
journalctl --user -u "relay@$platform.service" -n 30 --no-pager >&2
exit 1
