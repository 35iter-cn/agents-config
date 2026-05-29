# Refactoring: magicdoor-creating-pr-with-regression-doc

## Objective

Refactor the `magicdoor-creating-pr-with-regression-doc` skill to follow the `magicdoor-backend-api` architecture pattern: a thin dispatcher `SKILL.md` delegates to dedicated workflow files via a `--mode` flag or automatic state detection.

## Architecture

```
magicdoor-creating-pr-with-regression-doc/
├── SKILL.md                    # Dispatcher
└── workflows/
    ├── create-pr.md            # Create PR flow
    └── update-pr.md            # Update PR flow
```

The skill is written entirely in English.

## SKILL.md — Dispatcher

### Frontmatter

```yaml
name: magicdoor-creating-pr-with-regression-doc
description: >-
  Create or update a GitHub PR with regression test documentation for QA handoff
  in MagicDoor projects. Auto-detects whether to create a new PR or update an
  existing one by checking the branch state.
argument-hint: "[--mode create-pr | update-pr]"
```

### Process

The dispatcher handles shared pre-processing, then routes to the appropriate workflow. Execution order:

1. **Explicit `--mode` (highest priority)**
   - `--mode create-pr` → `@./workflows/create-pr.md`
   - `--mode update-pr`  → `@./workflows/update-pr.md`

2. **Default — auto-detect from branch state**
   - **Step 1: Verify and commit uncommitted changes**
     - Run `git status --short`
     - If output is non-empty, stage all changes and commit with an LLM-generated message
     - Do NOT proceed if the commit fails (e.g., pre-hook rejection)
   - **Step 2: Fetch and rebase**
     - `git fetch origin master`
     - `git rebase origin/master`
     - On conflict: STOP and ask the user to resolve manually — do not attempt automated conflict resolution
     - After the user resolves, ask what files conflicted and how they were resolved. Store this for inclusion in whichever PR body is built next.
   - **Step 3: Check for existing PR**
     - `gh pr view --json number,state`
     - State is `OPEN`  → `@./workflows/update-pr.md`
     - State is `MERGED` / `CLOSED`, or PR does not exist → `@./workflows/create-pr.md`

### Critical Rules

- Never guess the docs path — detect from project structure each time
- The regression doc link in the PR body MUST be an absolute `https://github.com/.../blob/{branch}/...` URL, never a relative path or a `master`-branch link
- Pre-push checks (format, lint, type-check) are mandatory in both flows
- If `gh pr view` fails with a non-existence error (exit code 1, no PR data), treat it as "PR does not exist" — route to create-pr

## workflows/create-pr.md

### Input

The current branch has no open PR.

### Steps

1. **Analyze Changes**
   - `git log origin/master..HEAD --oneline` — commit history
   - `git diff origin/master..HEAD --stat` — file change statistics
   - `git diff origin/master..HEAD --name-only` — list of changed files
   - Use these to determine the feature scope and generate the PR summary

2. **Detect Docs Architecture**
   - Check candidate paths in order, use the first that exists:
     1. `.knowledge/docs/`
     2. `docs/`
     3. `.github/docs/`
     4. Other `*/docs/` directories
   - Create under `.knowledge/docs/` if none exist

3. **Create Regression Doc**
   - Path: `{detected-docs-path}/{feature-slug}-regression.md`
   - Template includes: feature background, regression scope table, detailed test cases, relevant code entry points

4. **Commit Regression Doc**
   - `git add {docs-path}/`
   - `git commit -m "docs: add regression test doc for {feature}"`

5. **Pre-push Code Quality Checks**
   - Inspect `package.json` scripts for format/lint/type-check
   - Execute each in order. If any fails, STOP and report which check failed
   - Do NOT proceed until all checks pass and the working directory is clean

6. **Push Branch**
   - `git push origin {branch}`

7. **Create PR**
   - Detect PR template: `.github/pull_request_template.md`, `docs/PR_TEMPLATE.md`, `.github/PULL_REQUEST_TEMPLATE.md`
   - Build PR body with: summary, feature description, where-to-test table, test cases, edge cases, regression doc link
   - Regression doc link format (mandatory):
     ```
     https://github.com/{owner}/{repo}/blob/{branch}/{docs-path}
     ```
   - `gh pr create --title "..." --body "..."`

8. **Verify**
   - `gh pr view --json number,title,url,updatedAt`

## workflows/update-pr.md

### Input

The current branch already has an open PR (PR_NUMBER is known from the dispatcher).

### Steps

1. **Analyze New Changes** (since last push)
   - `git log origin/{branch}..HEAD --oneline` — new commits since last push
   - `git diff origin/{branch}..HEAD --stat` — new file changes
   - `git diff origin/{branch}..HEAD --name-only` — new file list

2. **Update Regression Doc**
   - Read existing regression doc from `{detected-docs-path}`
   - Append an "Updates" section documenting:
     - What changed (commit messages)
     - New test cases
     - New code entry points
   - If no regression doc exists, create one (same as create-pr flow)

3. **Commit Regression Doc Update**
   - `git add {docs-path}/`
   - `git commit -m "docs: update regression test doc for {feature}"`

4. **Pre-push Code Quality Checks**
   - Same as create-pr flow — inspect package.json, execute in order, STOP on failure

5. **Push Branch**
   - `git push origin {branch}`

6. **Update PR Body**
   - Read existing PR body via `gh pr view $PR_NUMBER --json body -q '.body'`
   - Append: recent changes summary, new commit log, updated file stats
   - Preserve existing content (regression doc link, feature description, etc.)
   - `gh pr edit $PR_NUMBER --body-file -`

7. **Verify**
   - `gh pr view $PR_NUMBER --json number,title,body,updatedAt`
   - Confirm new commits appear: `git log origin/{branch} --oneline -n 5`

## Migration Path

1. Write the new `SKILL.md` dispatcher
2. Write `workflows/create-pr.md`
3. Write `workflows/update-pr.md`
4. Remove old monolithic content (the existing `SKILL.md` is fully replaced)
5. Sync via `bin/sync-claude-skills`
6. Verify the skill loads correctly in Claude Code

## Key Differences From Current Skill

| Aspect | Current | Refactored |
|--------|---------|------------|
| File structure | Single ~500-line SKILL.md | Dispatcher + 2 workflow files |
| Language | Mixed Chinese/English | All English |
| Mode dispatch | Manual step-by-step | `--mode` flag or auto-detect |
| Uncommitted changes | STOP, ask user | Auto-commit by LLM |
| Pre-processing | Inline per flow | Shared in dispatcher |
| Argument interface | No argument-hint | `[--mode create-pr \| update-pr]` |
