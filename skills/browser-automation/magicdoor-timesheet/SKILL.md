---
name: magicdoor-timesheet
description: Use when the user mentions 日报, 周报, 月报, timesheet, fill missing, 补充, 更新月报, or asks to fill/backfill/sync the monthly MagicDoor Google Sheets timesheet (Hao-YYYY/MM)
---

# MagicDoor Timesheet

## Overview

Fill the monthly `Hao-YYYY/MM` sheet via the **Sheets API** using `mdsheet`. Every write is a single-cell HTTP PUT — atomic, no browser, no paste risk.

## Core Rules

- **Never hardcode grid positions** — detect via CLI (see Run): `mdsheet -s "$SID" layout` maps headers→column letters (eval-friendly); `mdsheet -s "$SID" find-date '<date>'` → absolute row.
- Only two write kinds exist; never plan around "本周 / 上周":

| Kind | Columns | Row | `work-summary` range |
|------|---------|-----|----------------------|
| 日报 | C=TASK, F=PR LINK | that day | that day |
| 周报 | G=NOTES | Saturday **S** | **S−7 … S−1** (never on S−7) |

- Data source: `work-summary` skill only (`--cwd ~/code/magicdoor`). If its PR section is empty, F stays empty; skip days with no commits/PRs entirely.
- **周报 default S** = latest Friday ≤ today, + 1 day. Before writing say: S, content window, target `G{row}`; confirm the DATE on that row is S. User named a non-Saturday → use `that Friday + 1` only if clearly a week-end.
- Do NOT guess HOURS (D) or KANBAN LINK (E).

## Run — Sheets API (~2 min)

```bash
SID=$(mdsheet find 'Hao-YYYY/MM' | cut -d' ' -f1)   # new month: mdsheet copy '<lastMonthTitle>' 'Hao-YYYY/MM'
eval "$(mdsheet -s "$SID" layout)"                  # header_row, <header>_col letters (e.g. date_col=B task_col=C pr_link_col=F notes_col=G)
```

1. Resolve rows: `D_ROW=$(mdsheet -s "$SID" find-date '<date>'); G_ROW=$(mdsheet -s "$SID" find-date '<S>')`. Column A often mirrors stray text — always drive writes from the layout map, never from the gutter.
2. Loop `work-summary` (each day in range + the weekly window) → JSON.
3. Render per-cell files matching the sheet's style:
   - TASK: `## project` + `- emoji subject` bullets
   - PR: `# PRs` + `- [MERGED] #N: title — url`
   - weekly NOTES: Chinese emoji bullets with `(#PR)`, no dashes
4. Write per cell (`set` ranges are pure A1, no tab prefix):
   - `mdsheet -s "$SID" -t "$TAB" set "$task_col$D_ROW" <file>`
   - `mdsheet -s "$SID" -t "$TAB" set "$pr_link_col$D_ROW" <file>`
   - weekly last: `mdsheet -s "$SID" -t "$TAB" set "$notes_col$G_ROW" <file>`
5. Verify: `mdsheet -s "$SID" get` → full-file sha256 equality (API returns raw newlines; no normalization). Also refresh `G{S}` whenever any day in its window was just filled.

Flags / auth: `mdsheet --help`. If 401/403: refresh via `gcloud auth application-default print-access-token`; revoked → re-run ADC login with `~/.config/magicdoor-sheets/client_secret.json` + `--scopes=cloud-platform,spreadsheets` and click the unverified-app interstitial in shared Chrome. Never revert to browser keyboard typing.

## Pitfalls

- **Sheets/Drive scopes are blocked for gcloud's built-in clients** — only the project's own OAuth client (project `magicdoor-timesheet`) mints them; Sheets AND Drive APIs must be `serviceusage :enable`d first.
- `find` only sees sheets created/authorized by this OAuth app — pre-app sheets need a one-time browser id lookup (record it); new month = `mdsheet copy '<lastMonthTitle>' '<newTitle>'` (full-file copy keeps banner/DATE layout; bare `create` is unformatted).
- Wrong cell content = rewrite that one cell (atomic writes can't scatter). Gross damage → File → Version history → Restore.
- Keyboard-era automation pitfalls (atob byte-strings, name-box focus gates, concurrent-session focus steal): preserved in project memory + AI-taught-me `tools/google-sheets-api-own-oauth-client`, and in `references/legacy-browser-automation.md`.