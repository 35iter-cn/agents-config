---
name: magicdoor-timesheet
description: Fill or sync the user's MagicDoor monthly Google Sheets timesheet. Only two write kinds — daily TASK/PR LINK and weekly NOTES on a Saturday row. Triggers on "日报", "周报", "timesheet", "fill missing", "补充", "更新月报".
---

# MagicDoor Timesheet

Fill or sync the `Hao-YYYY/MM` Google Sheet.

## Fast Path — Sheets API (PRIMARY, ~2 minutes; verified 2026-08-29)

Own OAuth client is set up; gcloud's built-in clients CANNOT mint Sheets scopes (`restricted_client`) — see §Pitfalls. One-time setup already done (project `magicdoor-timesheet`, Desktop client, client_secret at `~/.config/magicdoor-sheets/client_secret.json`, Sheets API enabled, ADC credentials saved, helper `mdsheet` — canonical source in this repo's `cli/` dir, synced to `~/.local/bin` by `scripts/sync-cli.mjs`).

Per run (row = 4 + calendar day; row 5 = day 1; header row 4):

1. One bash call: run `work-summary` in a loop (weekly range once + each day once) → JSON in /tmp.
2. Render per-cell texts to `/tmp/<month>/cells/*` (strip trailing newline). Match the sheet's established style: TASK = `## project` + `- emoji subject` bullets; PR = `# PRs` + `- [MERGED] #n: title — url`; weekly NOTES (G on Saturday S) = Chinese emoji bullets with `(#PR)`, no dashes, content = S−7 … S−1.
3. Write each cell: `SHEET_ID=<id> mdsheet set 'C26' <file>` — multiline-safe (whole file lands in ONE cell). Skip days with no commits/PRs. Weekly: `mdsheet set 'G{S}' <file>` where S = most recent Saturday.
4. Verify: `mdsheet get 'B33:G33'` — API returns RAW text WITH newlines, so verify by full-file sha256 (no normalization needed) or direct equality; empty-rule cells asserted empty. No browser, no keyboard, no focus gates.
5. If API fails (401/403): token refresh via `gcloud auth application-default print-access-token`; if revoked → re-run ADC login with `--client-id-file=$HOME/.config/magicdoor-sheets/client_secret.json --scopes=cloud-platform,spreadsheets` and click through the unverified-app interstitial in shared Chrome.

### If API unavailable (401/403/revoked)

No fallback inside this skill: refresh via `gcloud auth application-default print-access-token`; if revoked/re-consent needed → re-run ADC login with `--client-id-file=$HOME/.config/magicdoor-sheets/client_secret.json --scopes=cloud-platform,spreadsheets` and click through the unverified-app interstitial in shared Chrome. If that still fails, STOP and report; do NOT revert to browser keyboard automation.

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

1. Resolve `SHEET_ID` for `Hao-YYYY/MM` (recorded in this skill's run history / project memory; browser lookup via §Workflow.4 only when unknown).
2. Resolve the work directory: explicit path → common locations → ask.
3. Classify intent as **日报** and/or **周报**; derive dates from the rules above.
4. Run `work-summary` with `--cwd`, `--start-date`, `--end-date`.
5. Render cells + write + verify via the **Fast Path (Sheets API)**.
6. Open/create the sheet in the browser ONLY when `SHEET_ID` is unknown (new month).

## Prerequisites

- gcloud + ADC credentials from the project's own OAuth client, Sheets API enabled (see §Pitfalls)
- `mdsheet` helper (repo `cli/mdsheet`; `scripts/sync-cli.mjs` → `~/.local/bin/mdsheet`)
- `work-summary` skill with `--cwd` support
- `gh` CLI authenticated (for PR links)
- Browser driver on shared Chrome (CDP `127.0.0.1:9222`) ONLY for new-sheet creation or re-consent — routine runs are API-only

## Workflow

> Sections 1 / 4 / 5 are browser steps — needed ONLY for a new-month sheet or an unknown spreadsheet id. Routine runs use intent (3) → work-summary (6) → Fast Path API writes.

### 1. Browser (when needed)

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

### 4. Open or create sheet (browser)

Navigate to Google Sheets home. Look for `Hao-YYYY/MM`:

- If found: open it and **record its `SHEET_ID` in project memory** (routine runs never need the browser again).
- If not found: open the most recent existing monthly sheet, make a copy, rename it to `Hao-YYYY/MM`, clear data rows, adjust the first DATE formula to the 1st.
- If no previous sheet exists: ask the user to create the first one manually.

### 5. Detect layout (browser, only for a brand-new month)

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

### 7. After 日报 fills, refresh related 周报

When any day in `[S−7, S−1]` was filled or Saturday `S`'s `G` is blank, regenerate NOTES for that `S` (content `[S−7, S−1]` → `G` on `S`).

For `sync-month`: every Saturday row in the month with blank `G` and at least one non-empty daily in its content window gets a 周报 fill.

### 8. Post-write check (周报)

1. `G` on `S` has the NOTES.
2. `G` on `S−7` is **not** where this NOTES landed (unless that cell is a different week's report).
3. Cell directly below the written `G` is clean (no spill).
4. Verify through two independent channels (screenshot + per-cell formula-bar reads, or CSV export) — export alone gets rate-limited.

## Pitfalls (2026-08-29 verified)

- **Sheets/Drive scopes are BLOCKED for gcloud's built-in clients** (Google policy, verified): ADC login via default client demotes the grant to openid+email (gcloud crashes with "Scope has changed"); minting via auth-login's own client returns `403 restricted_client: Unregistered scope(s)`; even tokens carrying `cloud-platform` in tokeninfo get 403 from Sheets/Drive APIs. Remedy (already done): own OAuth client — GCP project + Auth Platform branding + Desktop client; ADC login with `--client-id-file` + `--scopes=cloud-platform,spreadsheets`; then ENABLE the Sheets API on that project (`serviceusage.googleapis.com:enable` works with the ADC token). Client JSON saved at `~/.config/magicdoor-sheets/client_secret.json`.
- The full write path is now API-only, so a wrong paste can no longer scatter into other rows. If a cell ends up with wrong content, just rewrite it via `mdsheet set`; for gross mistakes use **File → Version history → Restore** in the browser.
- Keyboard-era Sheets automation pitfalls (atob byte-string corruption, name-box/focus gates, formula-bar newline loss, concurrent-session focus steal, pkill self-match, Chrome download prompt) are preserved in project memory and the AI-taught-me repo (`tools/google-sheets-api-own-oauth-client`) — consult them if browser scripting of Sheets is ever needed again.

## Recovery

- A cell with wrong/extra content is a one-cell problem: re-render the file and `mdsheet set` that cell again (API writes are atomic per cell; scatter cannot happen).
- Gross damage (human edit, bad bulk script): **File → Version history → Restore** in the browser to the last clean revision.
- Auth/API failures: see Fast Path "If API unavailable".
