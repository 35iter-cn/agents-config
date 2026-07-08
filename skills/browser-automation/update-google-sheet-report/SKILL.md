---
name: update-google-sheet-report
description: Write a work-summary (day/week/custom range) into a Google Sheets monthly timesheet. Triggers on "更新/完善/填充 谷歌报表/月报/日报 的工作内容", "fill daily report", "update timesheet", or mentions 日报/月报. Supports daily and weekly ranges.
---

# Update Google Sheet Report

Write a `work-summary` output into the user's monthly Google Sheets timesheet (`Hao-YYYY/MM`).

## Prerequisite

Invoke `work-summary` with the target date range (day/week/custom) to generate the work summary, then write its output into the report. If the user's prompt only mentions filling/updating the report (e.g. "完善昨天的日报"), still invoke `work-summary` first — the summary is the data source.

## Date range derivation

`work-summary` requires explicit `--start-date` and `--end-date`. Derive them from the user's intent:

| User says | start-date | end-date | Write target row |
|------------|------------|----------|------------------|
| "昨天/今天/某天" (daily) | that day | that day | that day's row |
| "上周/本周/周报" (weekly) | last Saturday | this Friday | **today's row (this Saturday)** |

Weekly rule: the summary range is last Saturday → this Friday, but the write target is **today (this Saturday)**'s row — NOT the range start row. Run work-summary with `--start-date <last-saturday> --end-date <this-friday>`, then write into today's row.

Compute dates from today's date: `this Friday = today - (today.weekday - Friday)`, `last Saturday = this Friday - 6`.

## Range detection

From the `work-summary` JSON `dateRange`:
- `start === end` → **daily** branch
- `start !== end` → **weekly** branch

## Layout detection

Do NOT hardcode row numbers or assume header positions. Detect layout each run, but use URL-hash navigation instead of the name box (the name box does not reliably accept keyboard input in this automation context).

1. Open the target sheet from Google Sheets home, or navigate directly to:
   ```
   https://docs.google.com/spreadsheets/d/{id}/edit?gid={gid}#range=B1
   ```
   Use the active sheet's `gid` from the current URL. If the id/gid is unknown, open the sheet from the Google Sheets home page first.
2. Read the formula bar value to confirm you are on the header row. Move down with Down arrows or URL hashes (`#range=B2`, `#range=B3`, ...) until the formula bar value is `DATE`.
3. The `DATE` row is the header row; the next row is the data start.
4. Locate the target row. **Note**: DATE cells may contain formulas (e.g. `=C2+3`) rather than display values (e.g. `7/4`). If the formula bar value starts with `=`, do not expect it to equal the target date string. Instead, count rows from the data start: `target row = data start row + (target day - 1)`. Verify by reading the formula bar value — a formula like `=C2+N` where `N = target day - 1` confirms the right row.
5. From the DATE header cell, move right across the header row (Tab or URL hashes like `#range=C4`, `#range=D4`, ...) reading each formula bar value to map columns by **header text**, not by fixed column letter:
   - `TASK`
   - `HOURS`
   - `KANBAN LINK`
   - `PR LINK`
   - `NOTES`
   Record each column letter. Do **not** assume DATE is in column A; in the current sheet column A is empty and DATE is in column B.

## Writing (clipboard + paste)

Multi-line cells must be written via clipboard paste.

**Critical:** do **not** use `type_text` for multi-line content — `\n` is interpreted as Enter and will spread the content across multiple cells.

Before writing, ensure the browser page has focus so that `navigator.clipboard.writeText` succeeds:

- `select_page(pageId, bringToFront: true)`
- In JS: `window.focus(); document.body.focus();`

Then:

1. `await navigator.clipboard.writeText(text)` — write the full multi-line string to the clipboard.
2. Navigate to the target cell via URL hash, e.g. `#range=C11`.
3. Press Enter to enter edit mode.
4. Press Ctrl+V to paste.
5. Press Enter to confirm.
6. Verify only once per cell by navigating back to the target cell and reading the formula bar value.

## Cleanup / recovery

If a previous write attempt scattered content across cells below the target (e.g. C12, C13, C14, C15 after a failed multi-line input), detect and remove the residue before finishing:

1. Navigate to the cells directly below the target cell (`#range=C12`, `#range=C13`, ...).
2. Read the formula bar value for each.
3. If any contain unexpected task-like text, select the range (`#range=C12:C15`) and press Delete.

## Daily branch

- **Target row**: the row whose DATE value matches the target day.
- **TASK cell**: project name on line 1, then one `- {emoji} {description}` bullet per related commit (merge related commits). Append `(PR #{number})` when the project has a PR. Blank line between projects.
- **PR LINK cell**: project name on line 1, then `- {STATE} #{number}: {title} — {url}` per PR. Blank line between projects. `STATE` = uppercased `work-summary` PR state (MERGED/OPEN/CLOSED).
- **HOURS / KANBAN LINK**: leave empty unless the user gives exact values.

## Weekly branch

- **Target row**: today's row (this Saturday). The summary range is last Saturday → this Friday, but the write target is today — NOT the range start row. Compute via the date range derivation table above.
- **Target column**: `NOTES` (the last header column, detected in the layout step).
- **Content**: TASK text only (same format as daily TASK). Do NOT write PR LINK.
- **HOURS / KANBAN LINK / PR LINK**: all leave empty.

## Output format

**TASK / NOTES example:**

```
company-portal
- 🐛 修复 auth 模块：移除 access token 错误事件时的自动重定向逻辑（PR #5366）

frontend-common-module
- ✅ chore：移除 auth 包中误提交的 package-lock.json（PR #173）
```

**PR LINK example:**

```
company-portal
- MERGED #5366: fix(auth): remove redirect on access token error event — https://github.com/MagicDoorInc/company-portal/pull/5366

frontend-common-module
- MERGED #173: chore: remove accidental package-lock.json from auth package — https://github.com/MagicDoorInc/frontend-common-module/pull/173
```

## Emoji reference

🚀 Feature / major addition · 🛠️ Improvement / refactor · 🐛 Bug fix · ✅ Task / chore / cleanup · 📚 Documentation · ⚡ Performance

## Rules

- Never fill PR links into the KANBAN LINK column — PR links belong only in PR LINK (daily) or are omitted (weekly).
- Never guess HOURS or KANBAN LINK values.
- Never write via `cell.innerText` / JS DOM assignment — use clipboard + paste.
- Never use `type_text` for multi-line cell content — it splits across cells.
- Template naming convention for new monthly sheets: `Hao-YYYY/MM` (creating a new sheet is a manual user action, not automated by this skill).
