---
name: magicdoor-timesheet
description: Fill or sync the user's MagicDoor monthly Google Sheets timesheet. Supports single-day, range, missing-day, and full-month sync. Triggers on "fill timesheet", "update monthly report", "补充日报", "周报", "更新月报".
---

# MagicDoor Timesheet

Fill or sync daily TASK/PR LINK and weekly NOTES in the `Hao-YYYY/MM` Google Sheet.

## When to Use

- User asks to fill a daily or weekly timesheet.
- User wants to backfill missing days or sync the whole month.
- User mentions "日报", "周报", "月报", "timesheet", "fill missing", or "补充".

## When NOT to Use

- The user wants to edit HOURS or KANBAN LINK without providing exact values.
- The target project directory is not reachable and the user cannot provide one.

## Quick Start

1. Ensure debug Chrome is running (`chrome-debug` skill).
2. Resolve the work directory: explicit path → common locations → ask.
3. Derive the user's intent and date range.
4. Open or create the target monthly sheet.
5. Detect the sheet layout.
6. Invoke `work-summary` with `--cwd`, `--start-date`, `--end-date`.
7. Split the Markdown output and write to the correct cells via clipboard paste.

## Prerequisites

- `chrome-debug` skill
- `work-summary` skill with `--cwd` support
- `chrome-devtools` MCP
- `gh` CLI authenticated (for PR links)

## Workflow

### 1. Ensure Chrome

Check `http://127.0.0.1:9222/json/version`. If unreachable, invoke the `chrome-debug` skill.

### 2. Resolve work directory

Use the first matching layer:

1. Path in the user's prompt (e.g. "use `~/work/magicdoor`").
2. Common-location probing:
   - `magicdoor` → `~/code/magicdoor` → `~/MagicDoor` → `~/work/magicdoor`
3. Ask the user.

### 3. Interpret intent

| User intent | Action | Dates | Write target |
|-------------|--------|-------|--------------|
| "today", "今天", a date | `fill-single` | that day | that day's C and F |
| "this week", "本周", "周报" | `fill-single-weekly` | last Sat – this Fri | this Saturday's G |
| "last week", "上周" | `fill-single-weekly` | prev Sat – prev Fri | last Saturday's G |
| "7/21 to 7/24", "填这周的日报" | `fill-range` | derived range | each day's C and F |
| "补充缺失的日报" | `fill-missing` | scan sheet | each blank day's C and F |
| "更新月报", "sync month" | `sync-month` | scan sheet | all blank days + stale weekly G |

If ambiguous, ask.

### 4. Open or create sheet

Navigate to Google Sheets home. Look for `Hao-YYYY/MM`:

- If found: open it.
- If not found: open the most recent existing monthly sheet, make a copy, rename it to `Hao-YYYY/MM`, clear data rows, adjust the first DATE formula to the 1st.
- If no previous sheet exists: ask the user to create the first one manually.

### 5. Detect layout

1. Navigate to `#range=B1`.
2. Move down via URL hashes until the formula bar reads `DATE`.
3. Map header text to column letters by moving right across the header row.
4. Locate target rows by counting from the data start row.

Expected headers: DATE, TASK, HOURS, KANBAN LINK, PR LINK, NOTES.

### 6. Invoke work-summary

Invoke the `work-summary` skill with the derived parameters:

- `--start-date`: derived start date
- `--end-date`: derived end date
- `--cwd`: resolved work directory

Take its Markdown output and split it for the sheet:

- **TASK cell (C)**: everything before the `# PRs` heading.
- **PR LINK cell (F)**: the `# PRs` section.
- **Weekly NOTES cell (G)**: everything before the `# PRs` heading.

If `work-summary` returns no PRs, PR LINK stays empty.

### 7. Write

Multi-line cells via clipboard paste:

1. `select_page(pageId, bringToFront: true)`.
2. In page JS: `window.focus(); document.body.focus();`.
3. `await navigator.clipboard.writeText(text)`.
4. Navigate to target cell (`#range=C25`).
5. Enter, Ctrl+V, Enter.
6. Verify by reading the formula bar or taking a screenshot.

Never use `type_text` for multi-line content.

### 8. Weekly sync

After daily fills, regenerate weekly NOTES for any week where a day was filled or the Saturday NOTES cell is blank.

## Recovery

If content scattered below a target cell:

1. Navigate to cells directly below (`#range=C12`, `#range=C13`, …).
2. Read the formula bar for each.
3. If unexpected task-like text appears, select the range and press Delete.
