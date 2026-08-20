---
name: chrome-debug
description: Start/verify the shared debug Chrome instance exposing CDP on 127.0.0.1:9222
---

# Chrome Debug

Shared debug Chrome (CDP endpoint `ws://127.0.0.1:9222`).

**This is a shared resource across sessions.** Do not close or restart the
Chrome process unless connection is genuinely unrecoverable and the user has
confirmed. If MCP tools return errors, just notify the user—they will
reconnect.

## Start

```bash
google-chrome-stable --remote-debugging-port=9222 \
  --disable-gpu \
  --remote-allow-origins=* \
  --no-first-run --no-default-browser-check \
  --window-size=2560,1440 \
  --user-data-dir=$HOME/.config/chrome-debug
```

## Verify

```bash
curl -fsS http://127.0.0.1:9222/json/version || echo "chrome-debug not running"
```
