# Create PR

<objective>
Create a new GitHub PR with QA handoff details. When the PR template contains `REGRESSION_DOC_HERE`, also create and commit a regression doc.

**Output:** A new PR that is ready for review and QA handoff.
</objective>

<execution_context>
This workflow is called from `@./SKILL.md` when `--mode create-pr` is passed or when PR auto-detection finds no open PR.
</execution_context>

<when_to_use>
- Branch has no open PR.
- `--mode create-pr` was explicitly passed.
- Auto-detection found no PR or found a `MERGED` or `CLOSED` PR.
</when_to_use>

<process>
### Step 1 - Analyze Changes

Use `origin/master` as the comparison base:

```bash
git log origin/master..HEAD --oneline
git diff origin/master..HEAD --stat
git diff origin/master..HEAD --name-only
```

Determine the feature scope and generate the PR summary from this output.

### Step 2 - Resolve Docs Path

Resolve the docs path with lightweight detection:

1. If `.knowledge/docs/` exists, use it.
2. Otherwise inspect legacy paths `docs/` and `.github/docs/` for an existing regression doc or docs index that shows regression docs already live there.
3. If no usable path exists, create `.knowledge/docs/` and use it.

Keep this as a runtime path check only. Do not turn it into a docs migration step.

### Step 3 - [conditional] Create Regression Doc

Only run this step when the PR template contains `REGRESSION_DOC_HERE`.

Path: `{resolved-docs-path}/{feature-slug}-regression.md`

Template:

```markdown
# {Feature} Regression Test Checklist

## Feature Background

- Core feature description

## Regression Scope Overview

| # | Module | Path | Priority |
|---|--------|------|----------|

## Detailed Test Cases

### {Module Name}

| Step | Action | Expected |
|------|--------|----------|

## Relevant Code Entry Points

| Description | File |
|-------------|------|
```

Update any existing docs index file in the chosen docs location that already tracks regression docs, such as `entry.md`, `README.md`, or `index.md`.

### Step 4 - [conditional] Commit Regression Doc

Only run this step when Step 3 was executed.

```bash
git add {resolved-docs-path}/
git commit -m "docs: add regression test doc for {feature}"
```

### Step 5 - Pre-push Checks

Run `@./pre-push.md`.

If any executed check fails, stop here and report the failure.

### Step 6 - Push Branch

```bash
git push origin {branch}
```

### Step 7 - Create PR

Detect PR template candidates in this order:
1. `.github/pull_request_template.md`
2. `docs/PR_TEMPLATE.md`
3. `.github/PULL_REQUEST_TEMPLATE.md`

If a template exists:
- Use its content as the base PR body.
- If the template contains `REGRESSION_DOC_HERE`:
  - Replace the marker with the regression doc link.
  - The link format is:
    ```text
    https://github.com/{owner}/{repo}/blob/{branch}/{resolved-docs-path}/{feature-slug}-regression.md
    ```
- If the template does not contain `REGRESSION_DOC_HERE`, leave the template content unchanged.

Append the generated content after the template content:
- Summary
- Feature description
- Where-to-test table
- Test cases
- Edge cases

If no template exists, generate the full PR body directly with the same structure.

Get current branch:

```bash
git branch --show-current
```

Get owner and repo:

```bash
gh repo view --json owner,name -q '"\(.owner.login)/\(.name)"'
```

Create the PR:

```bash
gh pr create --title "..." --body "..."
```

### Step 8 - Verify

```bash
gh pr view --json number,title,url,updatedAt
```
</process>

<critical_rules>
- Never guess the docs path. Resolve it with the lightweight detection order in Step 2.
- The regression doc link must be an absolute branch-specific GitHub URL.
- Pre-push checks are mandatory. Do not skip them.
- Do not proceed to push or PR creation until executed checks pass.
- Keep docs-path resolution lightweight and local to this workflow.
- Only generate a regression doc when the PR template contains `REGRESSION_DOC_HERE`.
</critical_rules>

<success_criteria>
- The workflow keeps the required Step 1 through Step 8 structure.
- Regression doc creation and commit are skipped when the PR template lacks `REGRESSION_DOC_HERE`.
- PR template content is used as the body base when present.
- `REGRESSION_DOC_HERE` is replaced with the actual regression doc link when a doc was created.
- PR creation is verified with `gh pr view`.
</success_criteria>
