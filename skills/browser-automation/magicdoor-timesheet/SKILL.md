---
name: magicdoor-timesheet
description: Use when the user mentions 日报, 周报, 月报, timesheet, fill missing, 补充, 更新月报, or asks to fill/backfill/sync the monthly MagicDoor Google Sheets timesheet (Hao-YYYY/MM)
---

# MagicDoor Timesheet

## Overview

Fill the monthly `Hao-YYYY/MM` sheet via the Sheets API with `mdsheet` (full flags in `mdsheet --help`). Writes are atomic single-cell PUTs — no browser, no paste risk.

## Core Rules

- Two write kinds only; never plan around "本周/上周". Data source: `work-summary` skill only (`--cwd ~/code/magicdoor`).
- Targets detected, never assumed: `structure` maps headers→columns and prints `daily_cols="task_col pr_link_col"` / `weekly_cols="notes_col"`; `find-date '<date>'` resolves a DATE cell's absolute row.
- 日报 = that day's row, cells `$task_col` (TASK) + `$pr_link_col` (PR LINK). Skip days with no commits/PRs.
- 周报 = Saturday S's row, cell `$notes_col`; content window **S−7…S−1 — never written on S−7**. Default S = latest Friday ≤ today, + 1. Before writing, state S / window / target `G{row}`.
- New month: `mdsheet create '09/2026'` (copies the clean `Hao-TEMPLATE`, re-anchors C2, clears data — nothing else to do). `find` only sees app-created/authorized sheets; legacy sheets need a one-time browser id lookup.
- Never guess HOURS (D) or KANBAN LINK (E). 补充缺失: audit with `get`, write only blanks.

## Run

```bash
SID=$(mdsheet find 'Hao-YYYY/MM' | cut -d' ' -f1)
eval "$(mdsheet -s "$SID" structure)"
D_ROW=$(mdsheet -s "$SID" find-date '<date>'); G_ROW=$(mdsheet -s "$SID" find-date '<S>')
```

1. Loop `work-summary` (each day + the weekly window) → JSON.
2. Render per-cell files matching the sheet's style:
   - TASK: `## project` + `- emoji subject` bullets
   - PR: `# PRs` + `- [MERGED] #N: title — url`
   - weekly NOTES: Chinese emoji bullets `(#PR)`, no dashes
3. Write (A1 ranges only; `-t` overrides tab):
   - `mdsheet -s "$SID" set "$task_col$D_ROW" task.txt` / `set "$pr_link_col$D_ROW" prs.txt`
   - weekly last: `set "$notes_col$G_ROW" notes.txt`
4. Verify: `get` → full-file sha256 (API returns raw newlines). If any day in [S−7,S−1] was filled, refresh `G{S}`.

## Pitfalls

- Sheets/Drive scopes are blocked for gcloud's built-in clients — only this project's own OAuth client works, and both APIs must be `:enable`d. 401/403 → re-run the ADC login with `~/.config/magicdoor-sheets/client_secret.json`; never revert to browser typing.
- Wrong cell content = rewrite that one cell (atomic writes can't scatter). Gross damage → File → Version history → Restore.
- Keyboard-era canvas pitfalls (atob corruption, name-box focus gates, session focus steal): `references/legacy-browser-automation.md`.