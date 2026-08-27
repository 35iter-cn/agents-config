---
name: shared-chrome
description: Start/verify the shared Chrome instance exposing CDP on 127.0.0.1:9222, or operate a browser in it
---

# Shared Chrome

Shared Chrome instance (CDP endpoint `ws://127.0.0.1:9222`), preserves shared login state across sessions.

## Start

If CDP is unavailable, launch the shared instance:

```bash
google-chrome-stable --remote-debugging-port=9222 \
  --disable-gpu \
  --remote-allow-origins=* \
  --no-first-run --no-default-browser-check \
  --window-size=2560,1440 \
  --user-data-dir=$HOME/.config/shared-chrome
```

## Verify

```bash
curl -fsS http://127.0.0.1:9222/json/version || echo "shared Chrome not running"
```

## Shared Resource Rules

- This is a shared resource across sessions. Do not close or restart it unless connection is genuinely unrecoverable and the user has confirmed.
- Reuse existing tabs and login state. Do not switch to a different profile.
- If a browser tool cannot connect, notify the user rather than silently launching a second instance.
