---
name: chrome-debug
description: Start/verify the shared debug Chrome instance that MCP chrome-devtools connects to via --browser-url
---

# Chrome Debug

Shared debug Chrome for MCP chrome-devtools (`--browser-url=http://127.0.0.1:9222`).

**This is a shared resource across Claude sessions.** Do not close or restart the
Chrome process unless connection is genuinely unrecoverable and the user has
confirmed. If MCP tools return errors, just notify the user—they will
reconnect.

## Start

```bash
google-chrome-stable --remote-debugging-port=9222 \
  --headless=new \
  --remote-allow-origins=* \
  --no-first-run --no-default-browser-check \
  --window-size=2560,1440 \
  --user-data-dir=$HOME/.config/chrome-debug
```

## Verify

```bash
curl -s http://127.0.0.1:9222/json/version | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Browser','?'))"
```
