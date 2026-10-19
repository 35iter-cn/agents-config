---
name: agent-browser
description: Use when driving a browser through the agent-browser CLI — opening pages, clicking or filling by refs, extracting text, screenshots, E2E smoke tests, or attaching to the shared Chrome on CDP port 9222.
---

# agent-browser

Command reference: `agent-browser skills get core` (authoritative). This file carries only what it lacks.

## Start a task (once)

Register the task name. Marker files are empty; only the name matters, and a taken name is renamed, never shared:

```bash
REG="${XDG_RUNTIME_DIR:-/tmp/agent-browser-$UID}/agent-browser-tasks"; mkdir -p "$REG"
B='<domain>-<verb>-<object>'; TASK="$B"; n=1; set -o noclobber
while ! ( : > "$REG/$TASK" ) 2>/dev/null; do n=$((n+1)); TASK="$B-$n"; done
set +o noclobber; export AGENT_BROWSER_SESSION="$TASK"; printf 'task=%s\n' "$TASK"
```

- Prefer an id the workflow already has — a topic name (`2026-10-13-op-env-migration-young-wait`) or a claim id (`20261018-21`); else `<domain>-<verb>-<object>`.
- Lowercase `[a-z0-9-]`, ≤48 chars: the name is an env value, a filename, and the `--restore` key.
- One task, one name, for its whole life — never a timestamp or random suffix, which makes every call a new session. Parallel agents on one task take `-a` / `-b`. A rename means the printed `task=` is the real name — carry that into every later call.
- Registry is tmpfs, wiped at logout; re-register to resume (`~/.agent-browser/sessions/<name>` still matches).

## Every bash call (three steps)

Never run a bare `agent-browser` command: the unnamed session is shared by every agent on this machine and persists across conversations, so a bare command can hijack another task's page. Exports die with each shell, so re-run all three steps at the top of EVERY call:

1. **set** the task name into `AGENT_BROWSER_SESSION`
2. **read it back** with `agent-browser session`, so a wrong binding is visible in the log
3. **gate** — abort unless that name is registered

```bash
REG="${XDG_RUNTIME_DIR:-/tmp/agent-browser-$UID}/agent-browser-tasks"
export AGENT_BROWSER_SESSION='<task-name>'; agent-browser session
test -f "$REG/$AGENT_BROWSER_SESSION" || { echo "abort: '<task-name>' is not registered — run the Start a task block"; exit 1; }
agent-browser --cdp 9222 open <url>
```

Only the `test` stops anything — the shell keeps going after the read-back. A forgotten export aborts, and so does a mistyped name. Bare commands below are shorthand — wrap them.

Never satisfy the gate by creating the marker inline (`|| : > "$REG/$AGENT_BROWSER_SESSION"`): that silently takes a name another task owns. Collision-safe registration exists only in Start a task.

## Ref discipline

- Re-snapshot after every click/fill that changes the page: refs are snapshot-scoped, and a mutating page silently re-points or invalidates `@eN`.
- Ambiguous names ("Add new override" on five cards) ⇒ prove ownership via `eval` on DOM lineage or a full snapshot. Snapshot order is not ownership.
- "Element not found" ⇒ re-snapshot. Never retry an old ref under a new assumption.
- Icon-only buttons are invisible to the a11y tree ⇒ screenshot + coordinate click beats selector-poking in `eval`.

## Shared Chrome

Every command carries `--cdp 9222`, on the same line as the gate: the attach is re-established per invocation, so no daemon-memory binding exists to lose. Inside the task binding it reaches the human's real Chrome — real profile, real logins, their tabs.

- A command that cannot attach exits 1 with `All CDP discovery methods failed`. That is the outcome you want: stop and report it.
- A session with no attach does **not** error. The CLI silently launches a headless Chrome under `/tmp/agent-browser-chrome-*` and every later command in that session runs there — invisible to the human, wrong profile, wrong logins.
- `agent-browser connect 9222` also attaches, but keeps the binding in daemon memory only, and prints a misleading `[agent-browser] launched browser` while launching nothing.

Never "fix" a disconnect with `close` / `pkill` / restarts. Procedure and measurements: `references/shared-chrome.md`.

## Gotchas

`references/gotchas.md` — environment-specific failure modes: screenshot hangs, tab adoption, mock globs, idle timeout, dialogs.
