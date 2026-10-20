---
name: agent-browser
description: Use when driving a browser through the agent-browser CLI — opening pages, clicking or filling by refs, extracting text, screenshots, E2E smoke tests, or attaching to the shared Chrome on CDP port 9222.
---

# agent-browser

Command reference: `agent-browser skills get core` (authoritative). This file carries only what it lacks.

## Invoking the CLI

```bash
AGENT_BROWSER_SESSION='<task-name>' agent-browser --cdp 9222 <command> [args]
```

Two arguments, on every command, on the same line:

- `<task-name>` — the current task's name. Reuse it while its goal is undelivered and this call serves it; a new name only for a new goal (different site, different deliverable, or the last one shipped).
- `--cdp 9222` — the human's real Chrome: real profile, real logins, their tabs. Re-established per invocation.

## Common mistakes

- `export` on its own line or in an earlier shell — the name is gone by the time the command runs, and the CLI uses the shared `default` session: other tasks' tabs. No error, no warning.
- Omitting `--cdp 9222` — the session silently launches headless Chrome under `/tmp/agent-browser-chrome-*` and every later command stays there, invisible to the human, wrong profile, wrong logins. A command that cannot attach exits 1 with `All CDP discovery methods failed`: that is the outcome you want — stop and report.
- A misspelled or freshly invented name — a different session, with no tabs and a cold login. Not an error message.
- `agent-browser connect 9222` — binds in daemon memory only, and prints a misleading `[agent-browser] launched browser` while launching nothing.
- `close` / `pkill` / restarts to "fix" a disconnect — never. Procedure: `references/shared-chrome.md`.

## Ref discipline

- Re-snapshot after every click/fill that changes the page: refs are snapshot-scoped, and a mutating page silently re-points or invalidates `@eN`.
- Ambiguous names ("Add new override" on five cards) ⇒ prove ownership via `eval` on DOM lineage or a full snapshot. Snapshot order is not ownership.
- "Element not found" ⇒ re-snapshot. Never retry an old ref under a new assumption.
- Icon-only buttons are invisible to the a11y tree ⇒ screenshot + coordinate click beats selector-poking in `eval`.

## Gotchas

`references/gotchas.md` — environment-specific failure modes: screenshot hangs, tab adoption, mock globs, idle timeout, dialogs.
