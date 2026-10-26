# Agent Instructions

## Language

- All responses must be in Chinese.

## Input Style

- My input is dictated, so expect transcription errors (homophones, typos, odd phrasing). Infer my real intent from context; only confirm when a misread could cause a destructive action.
- When unsure about user intent (especially anything that could be destructive), ask probing follow-up questions to confirm instead of guessing and running. Grilling is cheaper than reworking a wrong guess.

## Baseline Analysis

- Before baseline analysis — reading a codebase to understand existing behavior before changing anything (cross-repo verification, reading a backend/BFF implementation, confirming whether something already exists, scoping a new task) — run `gco-latest <path>` on every read-only main checkout the task involves, at most once per repo per session.
- Main checkout means `git rev-parse --git-dir` equals `git rev-parse --git-common-dir`. Never run it in a linked worktree (`*.worktrees/`) or in a repo you are about to modify.
- If `gco-latest` fails (dirty tree, network), report the reason in one line and continue on the existing checkout. Never `git stash`, `git reset`, or `git checkout -f` to clear the way.

## Time Comparison

- Before comparing or judging any two timestamps — API response, log line, database row, git commit, file name — convert both to the same zone first. Default to the local zone (`Asia/Taipei`, `+08:00`); keep a foreign zone only when the data itself is defined in it.
- "Today" and "yesterday" are relative to that converted local time. Never read them off a log file name, a date inside a path, or a raw UTC date substring (`slice(0, 10)`).
- When a claim rests on the comparison, name the converted local time in the answer.

## Iron Rules

- No comments of any kind. Write self-explanatory code instead.
- Read the target repo's instruction file before any cross-repo write. Before modifying, creating, deleting, or moving a file outside the current workspace, find the file's git repo (walk up to `.git`) and read its root `AGENTS.md` (or `CLAUDE.md` if absent), then follow its rules. Read-only operations don't trigger this. Running build/test commands counts as a write. Skip repos already read this session. A baseline `gco-latest` refresh does not count as a write.
