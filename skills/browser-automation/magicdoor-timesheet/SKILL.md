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

1. Ensure shared Chrome is running (`shared-chrome` skill).
2. Resolve the work directory: explicit path → common locations → ask.
3. Classify intent as **日报** and/or **周报**; derive dates from the rules above.
4. Open or create the target monthly sheet.
5. Detect the sheet layout.
6. Invoke `work-summary` with `--cwd`, `--start-date`, `--end-date`.
7. Write cells via the driver-agnostic procedure in Workflow §7.

## Prerequisites

- Any browser automation driver attached to the shared Chrome (CDP `127.0.0.1:9222`) that provides the capability contract in §7 — e.g. chrome-devtools MCP, a Puppeteer/Playwright-backed browser tool, or any raw CDP client. The skill is driver-agnostic: map each step to whatever primitive your driver offers; never invent steps from another tool's API names.
- `shared-chrome` skill
- `work-summary` skill with `--cwd` support
- `gh` CLI authenticated (for PR links)

## Workflow

### 1. Ensure Chrome

Check `http://127.0.0.1:9222/json/version`. If unreachable, invoke the `shared-chrome` skill.

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

Navigation: prefer name-box jumps (focus `#t-name-box`, set value, Enter). `#range=` URL hashes can land as unexpected range selections.

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

### 7. Write cells — capability contract + verified edit loop

Multiline Markdown must land inside ONE cell. Pasting multiline text onto a selected-but-not-editing cell scatters it row-by-row down the sheet (this has destroyed a month before). The safe path is the cell **editor**, reached by keyboard, with focus asserted before every destructive key.

**Capability contract** — whatever browser driver is in use MUST provide equivalents of:

| Primitive | Purpose | Driver examples |
|---|---|---|
| Bring page to OS front | paste shortcuts are silently ignored when the tab lacks focus | MCP `select_page(bringToFront)`; puppeteer `page.bringToFront()` |
| Trusted keyboard events incl. modifier combos | Enter / Ctrl+A / Ctrl+V | MCP `press_key`; raw `keyboard.down('Control') → press('KeyA') → up` (wrapper `press("Control+V")` may reject combo strings) |
| In-page JS evaluation | name-box jumps, focus assertions, content readback | MCP `evaluate_script`; puppeteer-backed `evaluate` |
| Clipboard write | put the cell text on the system clipboard | `navigator.clipboard.writeText` via evaluation; needs page focus |
| ≥2 verification channels | screenshots / per-cell formula-bar reads / CSV export | CSV export can be rate-limited — never rely on it alone |

If any primitive is missing, stop and tell the user. Do not approximate with another tool's API names.

**Per-cell algorithm (REQUIRED, in order):**

1. Bring the page to the front.
2. Jump to the target cell via the name box (`#t-name-box`: focus it, set its value to the ref, press Enter), then **read back the name-box value — must equal the target**, else abort.
3. Press Enter to open the cell editor; **assert the focused element is the editor** (Sheets: `document.activeElement.id === 'waffle-rich-text-editor'`).
4. Write the cell text to the clipboard.
5. **Re-assert editor focus immediately before the keys**, then Ctrl+A and Ctrl+V inside the editor.
6. **Strict-compare** the editor's text against the expected text. Mismatch → bring-to-front again and retry ONCE; still mismatched → STOP and report.
7. Commit with Enter.

**Pilot rule:** write ONE cell first; read back the cell directly below (must be empty/unrelated) before batching.

**Red flags — STOP and re-verify if any of these happened:**

- A destructive key (Ctrl+A / Backspace / Ctrl+V) was sent without a fresh step-3/5 focus assertion. A stale check once selected all cells on the grid and deleted an entire month.
- Batching writes without per-batch bring-to-front — pastes become silent no-ops or hit the grid.
- Trusting one verification channel only.
- Coordinate-clicking Sheets' top chrome (formula bar, toolbars): overlapping elements intercept clicks at some x positions. Prefer keyboard-driven paths; the formula bar is acceptable only when focus is asserted at click time.

### 8. After 日报 fills, refresh related 周报

When any day in `[S−7, S−1]` was filled or Saturday `S`'s `G` is blank, regenerate NOTES for that `S` (content `[S−7, S−1]` → `G` on `S`).

For `sync-month`: every Saturday row in the month with blank `G` and at least one non-empty daily in its content window gets a 周报 fill.

### 9. Post-write check (周报)

1. `G` on `S` has the NOTES.
2. `G` on `S−7` is **not** where this NOTES landed (unless that cell is a different week's report).
3. Cell directly below the written `G` is clean (no spill).
4. Verify through two independent channels (screenshot + per-cell formula-bar reads, or CSV export) — export alone gets rate-limited.

## Recovery

If content scattered below a target cell:

1. Stop writing immediately.
2. Prefer **File → Version history → Restore** to the last clean revision (fastest full fix).
3. Or navigate cells below (`C12`, `C13`, …), read each via the formula bar, and clear unexpected task-like text using the §7 editor path (select-all + delete inside a focus-asserted editor; grid Delete on multiline is unreliable).
4. Re-write only via the §7 per-cell algorithm.
