---
name: work-summary
description: Generate a personal work summary from git commits and related PRs
category: workflow
date_added: "2026-06-02"
---

# Work Summary

Scan git history and GitHub PRs for a date range + author, output structured JSON. Used standalone (user asks for 日报/周报/custom-range summary) or as the read-only data source for other skills (e.g. magicdoor-timesheet).

## Run

```bash
node "$SKILL_DIR/work-summary.mjs" --start-date YYYY-MM-DD --end-date YYYY-MM-DD [--cwd path] [--author email] [--pr-state all|open|merged|closed]
```

- Dates are required, YYYY-MM-DD, inclusive. Derive from natural language:

| Intent | Range |
|---|---|
| 本周 / this week | F = latest Friday ≤ today; window F−6…F (Sat…Fri, the completed week — on Saturday "most recent Saturday" would wrongly anchor to today) |
| 上周 / last week | F−13…F−7 |
| 本月 / this month | 1st → today |
| today / exact dates / last N days | trivial; pass through |

Never anchor weeks on "most recent Saturday": on the reporting day (Saturday) it shifts the window into an empty future week.

- Defaults: `cwd` = current dir (scans one level of git subdirectories); `author` = `git config user.email`; `prState` = all.
- Non-zero exit → show stderr to the user; don't parse.

## JSON Output

Single JSON object on stdout:

```json
{
  "meta": { "generatedAt", "timezone", "prState" },
  "dateRange": { "start", "end" },
  "author": { "email", "name" },
  "warnings": [],
  "projects": [
    {
      "name": "...",
      "dir": "...",
      "commits": [{ "date", "subject", "hash" }],
      "prs": [{ "number", "title", "state", "url", "mergedAt", "createdAt" }]
    }
  ]
}
```

- Empty `projects` → no commits in range.
- Non-empty `warnings` → surface to user; usually `gh` not authenticated → `prs` missing.
- Squash-merge PR commits are deduplicated (paired numbered/bare subjects, regression-tested 2026-08); commits use author date.

## Rendering (standalone use)

- Per project: `## {name}` + up to 3 bullets, semantically merged commit subjects, emoji prefix (🚀 feature / 🛠 improvement / 🐛 fix / ✅ chore / 📚 docs / ⚡ perf).
- PRs: `# PRs` section, grouped by project: `- [{state}] #{number}: {title} — {url}`.