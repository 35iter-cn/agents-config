# Gotchas (observed in this environment)

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

- **Daemon exits after ~1h idle** and re-spawns on the next command; headless browser state is discarded unless the session used `--restore`. Attached (human-launched) browsers are exempt. Tune with `--idle-timeout`.
- **Backgrounded Chrome Memory-Saver tabs** get their renderer dropped: switching reloads the page and discards in-page state (`revived: true`) — treat prior state as gone, re-snapshot.
- **A tab with an open dialog** switches with `dialogBlocked: true`; resolve with `dialog accept` / `dialog dismiss` first. Native dialogs are not DOM, so `snapshot` never shows them.
