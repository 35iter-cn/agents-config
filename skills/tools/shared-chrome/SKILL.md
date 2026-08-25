---
name: shared-chrome
description: Use when operating a browser in the shared Chrome instance, using debug Chrome, or connecting to CDP on 127.0.0.1:9222
---

# Shared Chrome

Use the shared Chrome instance for browser automation and UI verification. It exposes CDP at `ws://127.0.0.1:9222` and preserves shared login state across sessions.

## Prepare

1. Check whether CDP is available:

```bash
curl -fsS http://127.0.0.1:9222/json/version || echo "shared Chrome not running"
```

2. If CDP is unavailable, report that the shared Chrome needs to be reconnected. Do not create a second browser instance.

3. Reuse the existing tabs and login state. Continue with the requested browser operation.

## Shared Resource Rules

- Do not close or restart shared Chrome.
- Do not change its profile or launch a replacement instance.
- If a browser tool cannot connect, report the connection failure and let the owner reconnect it.
