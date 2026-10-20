# Shared Chrome attach

Attach to the human's real Chrome (real profile, real logins) instead of spawning a browser. The shared instance exposes CDP on `ws://127.0.0.1:9222`; see the shared-chrome skill for launching it.

## Attach on every command

`--cdp 9222` re-attaches on the invocation, so nothing depends on daemon memory:

```bash
AGENT_BROWSER_SESSION='<task-name>' agent-browser --cdp 9222 snapshot -i
```

Prove the attach once per task; every command after it inherits the same target:

```bash
AGENT_BROWSER_SESSION='<task-name>' agent-browser --cdp 9222 get cdp-url | grep -q ':9222/devtools/browser/' || { echo "abort: not on the shared Chrome"; exit 1; }
```

## Why not `connect`

`connect 9222` attaches as well, but stores the binding in daemon memory only — nothing on disk in `/run/user/$UID/agent-browser/` records the CDP endpoint. Measured on 0.39.1, 2026-10-19:

- It prints `[agent-browser] launched browser` while launching nothing: no new Chrome process appeared across 250 samples at 20 ms, and `session info` reports `lifecycle.launched: false`.
- Kill that session's daemon, or upgrade the CLI (the daemon restarts on a version mismatch), and the next command silently launches a headless Chrome under `/tmp/agent-browser-chrome-*` and runs the rest of the task there. `connect` had already reported success, so nothing warns.
- With 9222 down, `connect 9222` exits 1 and the next command still launches that private headless browser. A failed `--cdp 9222` command instead leaves nothing running and fails again on the next call.

That silent fallback is the failure this rule exists to prevent: hours of E2E flow against a throwaway profile, tokens that appear to reset for no reason.

## Never salvage a mid-task disconnect

`close`, `pkill agent-browser`, and daemon restarts orphan the last-spawned browser. With `--cdp` on every command a lost attach surfaces as exit 1 rather than a silent switch — re-run the command, never reach for `close` / `pkill` / a restart. If it keeps failing, stop, verify what is running, and report it.

## Adopted tabs

After attaching, the session's tab registry includes every tab the shared Chrome already had: other sessions' marker pages, stale local-stack hosts, the human's own tabs. The implicit "current tab" is then unreliable — navigation can land on a leftover, and a tab opened by an in-page action (link click, shadow-login) may not appear in `tab list` at all.

```bash
agent-browser tab list                              # what the session sees
curl -fsS http://127.0.0.1:9222/json | node -e "JSON.parse(require('fs').readFileSync(0)).filter(t=>t.type==='page').forEach(t=>console.log(t.url))"   # what the browser has
```

Leftover tabs from other sessions ⇒ ask the human to close them. Then open a labeled tab (`tab new --label <task> <url>`) and address it by ref in every later command. When several sessions share one Chrome over `--cdp`, add `--pin-tab` (sticky, `AGENT_BROWSER_PIN_TAB=1`): the session sticks to its bound tab and fails with `tab_gone` instead of acting on another session's tab. A tab that "disappears" from your `tab list` is the same failure — stop and re-run the task binding; never fall back to bare commands in another session's view.
