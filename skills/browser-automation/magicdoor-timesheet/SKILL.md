---
name: magicdoor-timesheet
description: Fill or sync the user's MagicDoor monthly Google Sheets timesheet. Only two write kinds — daily TASK/PR LINK and weekly NOTES on a Saturday row. Triggers on "日报", "周报", "timesheet", "fill missing", "补充", "更新月报".
---

# MagicDoor Timesheet

Fill or sync the `Hao-YYYY/MM` Google Sheet.

There are **only two write kinds**. Do not use "本周 / 上周 / this week" as planning concepts.

| Kind | Columns | Row | `work-summary` range |
|------|---------|-----|----------------------|
| **日报** | TASK `C`, PR LINK `F` | that calendar day | that day → that day |
| **周报** | NOTES `G` | a **Saturday** | that Saturday − 7 days → that Saturday − 1 day |

## Core invariant (周报)

For target Saturday `S`:

- **Write:** `G` on `S`'s row
- **Content:** `[S − 7 days, S − 1 day]` (= previous Saturday through previous Friday)
- **Never** write that week's NOTES onto the Saturday that *starts* the content range (`S − 7`)

Example: `S = 2026-08-08` → content `2026-08-01` … `2026-08-07` → cell `G` on Aug 8. Not Aug 1.

### Default `S` when user says 「周报」 with no date

```
content_end = most recent Friday on or before today
S           = content_end + 1 day   # always a Saturday
content     = [S − 7, S − 1]
```

| Today | content_end | S (write) | Content |
|-------|-------------|-----------|---------|
| Fri 8/7 | 8/7 | 8/8 | 8/1–8/7 |
| Sat 8/8 | 8/7 | 8/8 | 8/1–8/7 |
| Sun 8/9 | 8/7 | 8/8 | 8/1–8/7 |
| Mon 8/10 | 8/7 | 8/8 | 8/1–8/7 |
| Thu 8/6 | 7/31 | 8/1 | 7/25–7/31 |

If the user names an explicit Saturday, use that as `S`. If they name a non-Saturday, ask or derive `S = that Friday + 1 day` when they clearly mean a week ending that Friday.

### Pre-write checklist (mandatory for 周报)

Before pasting NOTES, state out loud (in the agent trace / reply):

1. `S = …` (write Saturday)
2. Content = `S−7` … `S−1`
3. Sheet row for `S` → `G{row}`
4. Confirm formula bar / DATE on that row is `S` — **not** `S−7`

If step 4 fails, stop and fix the row mapping.

## When to Use

- User asks to fill 日报 or 周报.
- User wants to backfill missing days or sync the whole month.
- User mentions "日报", "周报", "月报", "timesheet", "fill missing", or "补充".

## When NOT to Use

- The user wants to edit HOURS or KANBAN LINK without providing exact values.
- The target project directory is not reachable and the user cannot provide one.

## Quick Start

1. Ensure debug Chrome is running (`chrome-debug` skill).
2. Resolve the work directory: explicit path → common locations → ask.
3. Classify intent as **日报** and/or **周报**; derive dates from the rules above.
4. Open or create the target monthly sheet.
5. Detect the sheet layout.
6. Invoke `work-summary` with `--cwd`, `--start-date`, `--end-date`.
7. Split the Markdown output and write cells via **formula-bar clipboard paste** (never paste onto the grid).

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

Only these actions exist:

| User intent | Action | Dates | Write target |
|-------------|--------|-------|--------------|
| "today", "今天", a single date | `fill-daily` | that day | that day's `C` and `F` |
| "7/21 to 7/24", "近几天的日报", "填日报" | `fill-daily-range` | derived day range | each day's `C` and `F` |
| "周报", optional Saturday / "写到 8/8" | `fill-weekly` | `S−7` … `S−1` (see Core invariant) | Saturday `S`'s `G` |
| "日报和周报", "近一周的日报和周报" | `fill-daily-range` + `fill-weekly` | dailies for the content window; weekly per rules above | each day's `C`/`F` + `S`'s `G` |
| "补充缺失的日报" | `fill-missing-daily` | scan sheet | each blank day's `C` and `F` |
| "更新月报", "sync month" | `sync-month` | scan sheet | blank dailies + blank Saturday `G` cells |

**Anti-patterns:**

- ❌ Do not plan around "本周 / 上周 / this week / last week".
- ❌ Do not write weekly NOTES to the Saturday that starts the content range.
- ❌ Do not put weekly NOTES in a non-Saturday row.

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
4. Locate target rows by counting from the data start row (or from seed date cell + offset).

Expected headers: DATE, TASK, HOURS, KANBAN LINK, PR LINK, NOTES.

Row mapping: if seed date `C2` is the 1st and data starts at row `R0`, then calendar day `D` is at row `R0 + (D − month_1st)`.

### 6. Invoke work-summary

Invoke the `work-summary` skill with the derived parameters:

- `--start-date`: derived start date
- `--end-date`: derived end date
- `--cwd`: resolved work directory

Take its Markdown output and split it for the sheet:

- **TASK cell (C)** (日报): everything before the `# PRs` heading.
- **PR LINK cell (F)** (日报): the `# PRs` section.
- **NOTES cell (G)** (周报): everything before the `# PRs` heading.

If `work-summary` returns no PRs, PR LINK stays empty. Skip a day's `C`/`F` when there are no commits and no PRs for that day (unless the user asked to write empty markers).

### 7. Write — **必须用公式栏粘贴**

Multiline Markdown **MUST** be pasted into the **formula bar** (公式栏), never onto a selected cell.

**Why:** Pasting onto a selected cell treats newlines as row breaks and scatters content across cells below (and can corrupt DATE/header rows). Pasting into the formula bar keeps all lines in one cell.

**Required sequence (per cell):**

1. `select_page(pageId, bringToFront: true)`.
2. `await navigator.clipboard.writeText(text)`.
3. Navigate to the target cell (name box or `#range=C25`).
4. **Click the formula bar** (the multiline input above the grid, first `.cell-input`).
5. Ctrl+A (optional if replacing), then **Ctrl+V into the formula bar**.
6. Press Enter to commit.
7. Verify: formula bar shows full multiline text; the cell **directly below** must still be empty/unrelated (not a spilled `- ` bullet).

**Pilot rule:** Write one cell first and confirm no pollution below before batching the rest.

**Never:**

- Paste onto a selected cell (grid focus) with multiline text.
- Use Enter→Ctrl+V→Enter on the grid as the primary path — easy to miss edit mode and scatter.
- Use `type_text` for multiline content.
- Use `document.execCommand('insertText')` or `document.execCommand('paste')` for multiline (strips or mangling newlines).

### 8. After 日报 fills, refresh related 周报

When any day in `[S−7, S−1]` was filled or Saturday `S`'s `G` is blank, regenerate NOTES for that `S` (content `[S−7, S−1]` → `G` on `S`).

For `sync-month`: every Saturday row in the month with blank `G` and at least one non-empty daily in its content window gets a 周报 fill.

### 9. Post-write check (周报)

1. `G` on `S` has the NOTES.
2. `G` on `S−7` is **not** where this NOTES landed (unless that cell is a different week's report).
3. Cell directly below the written `G` is clean (no spill).

## Recovery

If content scattered below a target cell:

1. Stop writing immediately.
2. Prefer **File → Version history → Restore** to the last clean revision (fastest full fix).
3. Or navigate cells below (`C12`, `C13`, …), read the formula bar, and clear unexpected task-like text via formula-bar select-all + delete (grid Delete on multiline is unreliable).
4. Re-write only via the formula-bar paste sequence above.
