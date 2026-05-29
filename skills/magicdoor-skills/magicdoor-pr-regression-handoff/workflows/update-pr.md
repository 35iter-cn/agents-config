# Update PR

<objective>
Update an existing GitHub PR with new commits and QA handoff details. Rebuilds the PR body from the PR template on every update. When the PR template contains `REGRESSION_DOC_HERE`, also updates the regression doc with an incremental `Updates` section.

**Input:** `PR_NUMBER` for the existing open PR.
</objective>

<execution_context>
This workflow is called from `@./SKILL.md` when `--mode update-pr` is passed or when PR auto-detection finds an open PR.
</execution_context>

<when_to_use>
- Branch already has an open PR.
- `--mode update-pr` was explicitly passed.
- Auto-detection found an existing PR with state `OPEN`.
</when_to_use>

<process>
Before Step 1, confirm `PR_NUMBER` is known.

- If auto-detection entered this workflow, reuse the PR number returned by `gh pr view --json number,state`.
- If `--mode update-pr` was used directly and `PR_NUMBER` is not already known, run `gh pr view --json number,state` first.
- If no open PR can be identified for the current branch, stop and ask the user instead of guessing.

### Step 1 - Analyze Changes

Analyze the full branch changes for PR body generation:

```bash
git log origin/master..HEAD --oneline
git diff origin/master..HEAD --stat
git diff origin/master..HEAD --name-only
```

Also analyze incremental changes since the last update for the regression doc `Updates` section:

```bash
git log origin/{branch}..HEAD --oneline
git diff origin/{branch}..HEAD --stat
git diff origin/{branch}..HEAD --name-only
```

If the incremental commands return no changes (branch is already synced with remote), skip Step 3 (`Updates` append) but still rebuild the PR body in Step 7.

### Step 2 - Resolve Docs Path

Resolve the docs path with lightweight detection:

1. If `.knowledge/docs/` exists, use it.
2. Otherwise inspect legacy paths `docs/` and `.github/docs/` for an existing regression doc or docs index that shows regression docs already live there.
3. If no usable path exists, create `.knowledge/docs/` and use it.

Keep this as a runtime path check only. Do not turn it into a docs migration step.

### Step 3 - [conditional] Update Regression Doc

Only run this step when the PR template contains `REGRESSION_DOC_HERE` and the incremental changes from Step 1 are non-empty.

Read the existing regression doc from the resolved docs path (`{resolved-docs-path}/{feature-slug}-regression.md`).

- If the doc exists, append an **Updates** section with what changed, new test cases, and new code entry points.
- If no regression doc exists, create one using the same structure as the create flow.

Use this format:

```markdown
## Updates

### {YYYY-MM-DD} Update

Changes in this update:

- {commit message}
- {commit message}

New regression test cases:
| Step | Action | Expected |
|------|--------|----------|

New code entry points:
| Description | File |
|-------------|------|
```

**Updates deduplication:** If an update for the same date (`{YYYY-MM-DD}`) already exists, append the new commits to that existing entry instead of creating a second entry for the same day.

### Step 4 - [conditional] Commit Regression Doc Update

Only run this step when Step 3 was executed.

```bash
git add {resolved-docs-path}/
git commit -m "docs: update regression test doc for {feature}"
```

### Step 5 - Pre-push Checks

Run `@./pre-push.md`.

If any executed check fails, stop here and report the failure.

### Step 6 - Push Branch

```bash
git push origin {branch}
```

### Step 7 - Update PR Body

Detect PR template candidates in this order:
1. `.github/pull_request_template.md`
2. `docs/PR_TEMPLATE.md`
3. `.github/PULL_REQUEST_TEMPLATE.md`

If a template exists:
- Use its content as the base PR body.
- If the template contains `REGRESSION_DOC_HERE`:
  - Replace the marker with the current regression doc link.
  - The link format is:
    ```text
    https://github.com/{owner}/{repo}/blob/{branch}/{resolved-docs-path}/{feature-slug}-regression.md
    ```
- If the template does not contain `REGRESSION_DOC_HERE`, leave the template content unchanged.

Append the generated content after the template content:
- PR Summary (based on `origin/master..HEAD`)
- File Changes table
- Where-to-test notes
- Edge cases

If no template exists, generate the full PR body directly with the same structure.

Replace the existing PR body entirely with the newly generated body. Do not preserve old content.

Update the PR:

```bash
gh pr edit $PR_NUMBER --body-file /tmp/pr_body_updated.md
```

### Step 8 - Verify

```bash
gh pr view $PR_NUMBER --json number,title,body,updatedAt
git log origin/{branch} --oneline -n 5
```
</process>

<critical_rules>
- Rebuild the PR body from template on every update. Do not preserve old content.
- Replace `REGRESSION_DOC_HERE` marker with actual link when present.
- Never guess the docs path. Resolve it with the lightweight detection order in Step 2.
- Pre-push checks are mandatory. Do not skip them.
- Do not proceed to push or PR update until executed checks pass.
- Keep docs-path resolution lightweight and local to this workflow.
- Only update the regression doc when the PR template contains `REGRESSION_DOC_HERE` and incremental changes exist.
- If incremental changes are empty, skip the `Updates` append but still rebuild the PR body.
</critical_rules>

<success_criteria>
- The workflow keeps the required Step 1 through Step 8 structure.
- Regression doc update and commit are skipped when the PR template lacks `REGRESSION_DOC_HERE` or when incremental changes are empty.
- PR body is rebuilt from template on every update, not preserved.
- `REGRESSION_DOC_HERE` is replaced with the actual regression doc link when the marker exists.
- New commits are visible on the remote branch after push.
- PR update is verified with `gh pr view`.
</success_criteria>
