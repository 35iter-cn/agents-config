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

## Layout detection (name box + formula bar)

Do NOT hardcode row numbers or assume header positions. Detect layout each run:

1. Click the name box (top-left, shows a cell ref like `A1`), type `B1`, press Enter.
2. Read the formula bar `combobox` value in the a11y snapshot — it shows the current cell's content.
3. Press Down arrow to move to `B2`, `B3`... reading the combobox value each time, until you find the cell whose value is `DATE`. That row is the DATE header row. The next row is the data start.
4. Continue Down to locate the target row. **Note**: DATE cells may contain formulas (e.g. `=C2+3`) rather than display values (e.g. `7/4`). If the combobox value starts with `=`, do not expect it to equal the target date string. Instead, count rows from the data start: `target row = data start row + (target day - 1)`. Verify by reading the combobox value — a formula like `=C2+N` where `N = target day - 1` confirms the right row.
5. From the DATE cell, press Tab to move right across the header row, reading each combobox value to map columns: `TASK`, `HOURS`, `KANBAN LINK`, `PR LINK`, `NOTES`. Record each column letter.

To verify any cell's content after editing: jump to it via the name box and read the combobox value — it must equal the expected text including newlines. (For non-formula cells like TASK/NOTES, the combobox value is the literal text.)

## Writing (clipboard + paste)

Multi-line cells must be written via clipboard paste, not Alt+Enter line-by-line and not `cell.innerText` assignment (which does not persist).

1. `await navigator.clipboard.writeText(text)` — write the full multi-line string to the clipboard.
2. Name box → target cell → press Enter to enter edit mode → press Ctrl+V to paste → press Enter to confirm.
3. Jump back to the cell and read the combobox value to verify it persisted.

## Daily branch

- **Target row**: the row whose DATE value matches the target day.
- **TASK cell**: project name on line 1, then one `- {emoji} {description}` bullet per related commit (merge related commits). Append `(PR #{number})` when the project has a PR. Blank line between projects.
- **PR LINK cell**: project name on line 1, then `- {STATE} #{number}: {title} — {url}` per PR. Blank line between projects. `STATE` = uppercased `work-summary` PR state (MERGED/OPEN/CLOSED).
- **HOURS / KANBAN LINK**: leave empty unless the user gives exact values.

## Weekly branch

- **Target row**: today's row (this Saturday). The summary range is last Saturday → this Friday, but the write target is today — NOT the range start row. Compute via the date range derivation table above.
- **Target column**: `NOTES` (the last header column, detected in step 5 above).
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
- Template naming convention for new monthly sheets: `Hao-YYYY/MM` (creating a new sheet is a manual user action, not automated by this skill).
