# Gotchas (observed in this environment)

- **`type` needs a selector**: `type @e975 "addr"`. Passing the text alone is parsed as a selector and fails silently (exit 0, nothing typed) — use `keyboard type` only for a focused contenteditable (Gmail body, editors).
- **`screenshot` takes the path positionally**: `screenshot /tmp/x.png`, not `screenshot -o /tmp/x.png` (the `-o` is read as a selector: "Element not found: -o").
- **`tab_gone` mid-task** usually means another session or the human closed the bound tab, not that the session died: `tab list` → `tab t<N>` rebinds, and `@eN` refs from the previous snapshot keep working.
- **`screenshot` can hang** (`Page.captureScreenshot` timeout) on canvas/media-heavy pages and chrome:// pages. Retry on a simpler page, or use `--screenshot-format jpeg --screenshot-quality 80` into an existing directory.
- **Avoid `wait --load networkidle`** on SSE/WebSocket-heavy pages (portals, dashboards); use `wait --text`, `--url`, or `--fn`.
- **Headless hides scrollbars**; the shared Chrome over `connect` is headed and unaffected.
- **API mocks need `--resource-type xhr,fetch`** (0.39+). A pattern-only route also hits the app's own source files when the path matches the glob — mocking `**/audits/**` replaced vite's `/src/swagger/audits/Api.ts` with fake JSON, the module graph died, and the page Oopsed. Add narrow globs (`**/audits/company-portal/audit-entries*`) as double insurance. A poisoned vite dep cache may need a dev-server restart.

```bash
agent-browser network route "**/api/**" --status 200 --body '{...}' --resource-type xhr,fetch   # stub
agent-browser network route "**/analytics" --abort --resource-type xhr,fetch                    # block
agent-browser network requests                                                                  # what fired
agent-browser network unroute "**/api/**"                                                       # undo (no naked `unroute`)
agent-browser network har start / stop /tmp/trace.har                                           # record
```

- **Daemon exits after ~1h idle** and re-spawns on the next command; headless browser state is discarded unless the session used `--restore`. A shared Chrome reachable over CDP survives that exit — but a `connect` binding does not: the next command silently launches its own headless Chrome. That is why every command carries `--cdp 9222` (`references/shared-chrome.md`). Tune the idle window with `--idle-timeout`.
- **Backgrounded Chrome Memory-Saver tabs** get their renderer dropped: switching reloads the page and discards in-page state (`revived: true`) — treat prior state as gone, re-snapshot.
- **A tab with an open dialog** switches with `dialogBlocked: true`; resolve with `dialog accept` / `dialog dismiss` first. Native dialogs are not DOM, so `snapshot` never shows them.
