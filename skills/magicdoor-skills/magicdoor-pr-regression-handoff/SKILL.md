---
name: magicdoor-pr-regression-handoff
description: >-
  Create or update a GitHub PR with regression test documentation for QA handoff
  in MagicDoor projects. Auto-detects whether to create a new PR or update an
  existing one by checking the branch state.
argument-hint: "[--mode create-pr | update-pr]"
---

# MagicDoor PR Regression Handoff

<objective>
Create or update a GitHub PR for QA handoff. Uses the PR template and `REGRESSION_DOC_HERE` marker to control regression doc generation.
</objective>

<execution_context>
@./workflows/create-pr.md
@./workflows/update-pr.md
@./workflows/pre-push.md
</execution_context>

<context>
- Parse `--mode` first. Supported values are `create-pr` and `update-pr`.
- When a PR template contains the marker `REGRESSION_DOC_HERE`, the skill generates or updates a regression doc and replaces the marker with the doc link.
- When no marker is present, no regression doc is generated.
- The marker is the only control mechanism; there is no `--skip-regression-doc` flag.
</context>

<process>
1. If `--mode create-pr` is provided, run `@./workflows/create-pr.md`.
2. If `--mode update-pr` is provided, run `@./workflows/update-pr.md`.
3. If `--mode` is not provided, run pre-processing then auto-detect:

    **Pre-step: Verify and commit uncommitted changes**

    ```bash
    git status --short
    ```

    If output is non-empty, stage all changes and commit with an LLM-generated message. Do NOT proceed if the commit fails.

    **Pre-step: Fetch and rebase**

    ```bash
    git fetch origin master
    git rebase origin/master
    ```

    On conflict: STOP and ask the user to resolve manually. After the user resolves, ask what files conflicted and how they were resolved. Store this for the PR body.

    **Auto-detect:**

    - Run `gh pr view --json number,state`.
    - If the PR state is `OPEN`, capture the returned PR number as `PR_NUMBER` and run `@./workflows/update-pr.md`.
    - If the PR state is `MERGED` or `CLOSED`, run `@./workflows/create-pr.md`.
    - If `gh pr view` returns no PR data or exit code `1`, treat that as "no existing PR" and run `@./workflows/create-pr.md`.
4. In either workflow, resolve docs path with the lightweight detection order described there: `.knowledge/docs/` first, then legacy paths, otherwise create `.knowledge/docs/`.
</process>

<critical_rules>
- Never guess the docs path. Use the lightweight detection sequence defined in the workflow every time.
- Use `@./workflows/pre-push.md` before any push in both modes.
- If any executed pre-push check fails, stop and report the failure. Do not continue to push or PR operations.
- In both create and update modes, use the PR template as the body base when one exists.
- In update mode, rebuild the PR body from the template and current code state. Do not preserve old content.
- Use `REGRESSION_DOC_HERE` marker in PR template to control regression doc generation. No other flag controls this.
- In create mode, include a regression doc link only when the template contains `REGRESSION_DOC_HERE`.
- In update mode, replace `REGRESSION_DOC_HERE` with the current regression doc link if the marker exists.
- Keep docs-path resolution lightweight. Do not turn this runtime flow into a docs-structure migration.
</critical_rules>

<success_criteria>
- `SKILL.md` dispatches correctly by explicit mode or PR-state auto-detection.
- Both workflows use the shared pre-push checks and lightweight docs-path resolution.
- Both create and update flows use a PR template as the body base when available.
- Update flow rebuilds the PR body from template on every update.
- `REGRESSION_DOC_HERE` marker drives regression doc generation in both modes.
- Update flow appends an `Updates` section to the regression doc with incremental changes.
- No `--skip-regression-doc` flag exists anywhere in the skill.
</success_criteria>

<ask_user_instead_of_guessing>
- Rebase conflicts that require manual resolution.
- Docs path cannot be confirmed from `.knowledge/docs/`, `docs/`, or `.github/docs/`, and `.knowledge/docs/` cannot be created safely.
- `--mode update-pr` was requested but no open PR can be identified for the current branch.
</ask_user_instead_of_guessing>
