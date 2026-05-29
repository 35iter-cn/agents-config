---
name: work-summary
description: Use when generating a personal work summary from git commits and related PRs, especially when the user provides or implies a time range, wants current-user filtering, author-date-based counting, project-grouped output, or grouped PR links.
argument-hint: "[--mode today|week]"
---

<when_to_use>

- User requests a daily, weekly, or custom-range work summary
- User wants per-author filtering, author-date counting, project-grouped output, or PR links

</when_to_use>

<context>

- `--mode today` (default): START_DATE = END_DATE = current local date
- `--mode week`: Saturday–Friday natural week. START_DATE = most recent Saturday, END_DATE = corresponding Friday
- Non-git parent dirs: scan only **one level** of direct subdirectory repos. Never recurse deeper.

</context>

<objective>

Turn commit history into a concise, project-grouped personal work summary, merging related commits into at most 3 meaningful items per project. Append a matching PR section. Output as raw Markdown inside a code block.

</objective>

<execution_context>

`work-summary.sh` in the same directory provides mode parsing, date range computation, and project discovery (`MODE`, `START_DATE`, `END_DATE`, `IS_GIT`, `PROJECT_COUNT`, `PROJECT_<N>_{NAME,DIR}`).

</execution_context>

<critical_rules>

### User Identity & Date Scope

- Default: current user only. Resolve via `git config --get user.email`, match author email exactly. Never guess.
- Filter by **author date** (`%as`), not committer date. `--since`/`--until` alone are insufficient.
- Relative dates resolve at runtime. Never hardcode.

### Project Grouping

- Group commits by project, merge related subjects — never dump a raw list.
- Max 3 items per project. Fewer than 3? Write fewer. Never pad.

### Squash Merge

- A squash-merge commit (`#123` in subject) is NOT new work if the repo has earlier topically-related commits. Exclude it.

### PR Section

- Include by default. Same user, same time range as work summary.
- Default: all states (open/merged/closed) unless user specifies a filter.
- Group by project. Supplementary to the summary.

### Non-Git Directories

- Not a git repo? Scan only **one level** of subdirectories. Never recurse.
- Run full process against each repo independently, then merge results.

### Summary Quality

- Write as "action + outcome/purpose". Emoji prefix required. No raw commit subjects.

</critical_rules>

<process>

### Step 1: Resolve Mode, Date Range, and Projects

```bash
meta=$(sh "<skill-dir>/work-summary.sh" --mode "$mode")
# Returns MODE, START_DATE, END_DATE, IS_GIT, PROJECT_COUNT, PROJECT_<N>_{NAME,DIR}
```

Default `today`; `--mode week` for weekly summaries.

### Step 2: Identify the Author

```bash
git config --get user.email
```

### Step 3: Fetch & Filter

```bash
email=$(git config --get user.email)
git log --all --no-merges --format='%as%x09%aE%x09%s' |
awk -F'\t' -v start="$START_DATE" -v end="$END_DATE" -v email="$email" '
  $1 >= start && $1 <= end && tolower($2) == tolower(email) { print $3 }'
```

### Step 5: Summarize Into Work Items

1. Group by project → merge related subjects → write as "action + outcome/purpose"
2. Max 3 per project. Format per `<output>` template.

### Step 6: Collect PRs for the Same Range

1. Query current user's PRs. Default: all states (open/merged/closed).
2. Same time range as work. Group URLs by project. Append `# PRs` section.

</process>

<success_criteria>

- [ ] Current user only, author date, grouped by project, max 3 items, no raw subjects
- [ ] Squash merges excluded when they re-package earlier work
- [ ] Output wrapped in ````markdown`, each item starts with emoji
- [ ] PR section included (unless opted out), same user and range, all states, grouped by project
- [ ] Non-git directories delegated to one-level subdirectory repos

</success_criteria>

<output>

````markdown
```markdown
# <Time Range> Work Summary

## Project Name

- 🚀 Merged key item describing what was done and the outcome
- 🛠️ Another item with action + result
- 🐛 Bug fix: what was wrong and how it was resolved

## Another Project

- ✅ A representative work item from this period

# PRs

## Project Name

- https://github.com/org/repo/pull/123
- https://github.com/org/repo/pull/128

## Another Project

- https://github.com/org/repo/pull/285
```
````

</output>
