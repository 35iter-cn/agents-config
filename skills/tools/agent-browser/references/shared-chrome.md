# Shared Chrome attach

Attach to the human's real Chrome (real profile, real logins) instead of spawning a browser. The shared instance exposes CDP on `ws://127.0.0.1:9222`; see the shared-chrome skill for launching it.

## Bind, then connect

`connect` is session-scoped, not daemon-global: it binds the shared browser to the CURRENT session only. Run it without a task name and only the default session is attached — every later command bound to a task then finds "no browser" and the daemon SILENTLY launches its own headless instance. Its tabs and pages clone the shared Chrome's, so nothing visibly fails until a site that blocks the `HeadlessChrome` UA 403s on every document page (X/Twitter does this while robots.txt still loads fine).

```bash
REG="${XDG_RUNTIME_DIR:-/tmp/agent-browser-$UID}/agent-browser-tasks"
TASK='<task-name>'
export AGENT_BROWSER_SESSION="$TASK"; printf 'session=%s\n' "$AGENT_BROWSER_SESSION"
test -f "$REG/$AGENT_BROWSER_SESSION" || { echo "abort: task '$AGENT_BROWSER_SESSION' not registered"; exit 1; }
agent-browser connect 9222
agent-browser snapshot -i
```

Watch for the `[agent-browser] launched browser` line: it usually means a NEW browser was spawned instead of attaching, but 0.39.0 also printed it on a successful attach (observed 2026-10-12), so it is a trigger to verify, not a verdict.

Rules inherited from the shared-chrome skill:

- It is a shared resource: never close or restart it, reuse existing tabs and login state, do not switch profiles.
- `connect` binds to the daemon, not to the process, so it survives across CLI invocations.

## Verify the attach landed

Page contents and URLs prove nothing: a stale daemon's own headless instance has the same URLs and titles. Use a mark that only the shared browser can hold.

```bash
agent-browser eval "document.title = 'AB-MARK-' + Date.now()"
curl -fsS http://127.0.0.1:9222/json | grep -c AB-MARK   # 1 = attached; 0 = driving its own instance
agent-browser eval "navigator.userAgent"                  # must NOT contain HeadlessChrome
```

A mark only proves the mark reached port 9222, not that the session you drive is the one attached there (binding is per-session). Re-run BOTH checks whenever the binding is re-run, not once per connect. Observed 2026-10-12: mark verified right after a bare `connect`, then all work moved to a different session → silent headless instance, hours-adjacent confusion, X/Twitter 403 on every navigation.

For a read-only task, prefer the UA check over the title mark — the mark overwrites the human's tab title.

If the mark is missing, look for a second chrome parent (`ps aux | grep -E 'chrome.*remote-debugging-port=0|agent-browser-chrome'`) — that is the headless instance a previous daemon generation spawned. Kill it and relaunch the shared Chrome from its launcher.

## Never salvage a mid-task disconnect

`close`, `pkill agent-browser`, and daemon restarts orphan the last-spawned browser; the next connect re-launches a fresh headless one, which is the split-instance loop that makes a whole session's work unverifiable (observed 2026-10-11: hours of E2E flow across two instances, tokens appearing to reset for no reason). If a reconnect seems necessary, stop, verify what is running, then restart the shared Chrome from its launcher.

## Adopted tabs

After connecting, the session's tab registry includes every tab the shared Chrome already had: other sessions' marker pages, stale local-stack hosts, the human's own tabs. The implicit "current tab" is then unreliable — navigation can land on a leftover, and a tab opened by an in-page action (link click, shadow-login) may not appear in `tab list` at all.

```bash
agent-browser tab list                              # what the session sees
curl -fsS http://127.0.0.1:9222/json | node -e "JSON.parse(require('fs').readFileSync(0)).filter(t=>t.type==='page').forEach(t=>console.log(t.url))"   # what the browser has
```

Leftover tabs from other sessions ⇒ ask the human to close them. Then open a labeled tab (`tab new --label <task> <url>`) and address it by ref in every later command. When several sessions share one Chrome over `connect`/`--cdp`, add `--pin-tab` (sticky, `AGENT_BROWSER_PIN_TAB=1`): the session sticks to its bound tab and fails with `tab_gone` instead of acting on another session's tab. A tab that "disappears" from your `tab list` is the same failure — stop and re-run the task binding; never fall back to bare commands in another session's view.
