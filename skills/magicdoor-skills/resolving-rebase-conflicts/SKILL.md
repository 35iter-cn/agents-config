---
name: resolving-rebase-conflicts
description: >-
  Use when rebasing a feature branch onto origin/master or origin/main and
  encountering or anticipating merge conflicts. Triggered when the branch has
  diverged from the main branch with overlapping file changes, workflow
  modifications, lockfile updates, or dependency changes that will produce
  conflicts during rebase.
---

# Resolving Rebase Conflicts

<objective>
Systematically resolve rebase conflicts by first performing an isolated dry-run
to discover the full conflict surface, analyzing and proposing a resolution plan
for user confirmation, then executing the actual rebase with a clear end-state
goal without intermediate interruptions.
</objective>

<execution_context>
- Git repository with a feature branch that needs rebasing onto the latest main branch.
- Access to `git` CLI including `git worktree`, `git merge`, `git rebase`.
- `/tmp` or equivalent writable temp directory for isolated dry-run.
</execution_context>

<context>
- **LMB**: Latest main branch. Infer: `origin/master` → `origin/main`. Ask if neither.
- **Dry-run worktree**: `/tmp/dry-run-<timestamp>-<branch-name>`.
- **Conflict surface**: Files that would conflict on a direct merge from LMB into HEAD.
</context>

<when_to_use>
Use when:

- A feature branch has fallen behind `origin/master` or `origin/main` and a
  rebase is required before merging.
- `git rebase` is expected to produce conflicts due to overlapping changes in
  workflows, `package.json`, lockfiles, or source files.
- The user explicitly asks to resolve conflicts with a branch or origin remote.
- The user says "rebase" or "solve conflicts" in the context of a diverged branch.

Do not use when:

- There are no conflicts and a simple `git rebase` or `git merge` will succeed.
- The user wants to merge rather than rebase (use standard merge flow).
</when_to_use>

<process>

### Step 1: Determine LMB and fetch

```bash
git fetch origin
```

Check remote main branch existence in this order: `origin/master`, `origin/main`.
Use the first one found as **LMB**. Record the short ref name (`master` or `main`).

### Step 2: Isolated dry-run in worktree [HARD GATE]

Run the dry-run script from the skill directory:

```bash
./scripts/dry-run-conflicts.sh [LMB] [FEATURE_BRANCH]
```

If output starts with `RESULT: clean`, report: "No conflicts detected. Safe to
rebase directly." Then stop.

If output starts with `RESULT: conflicts`, parse the conflict file list and
grep output for analysis.

### Step 3: Analyze conflict surface

Classify each conflicted file into a category:

| Category | Typical files | Resolution strategy |
| --- | --- | --- |
| **Lockfile** | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` | Discard both versions; regenerate from resolved `package.json`. |
| **Dependency manifest** | `package.json`, `Cargo.toml`, `pyproject.toml` | Merge scripts/tooling changes; keep higher dependency versions unless the branch specifically downgrades for compatibility. |
| **CI / Workflow** | `.github/workflows/*.yml` | Retain both sides: branch's tooling changes + LMB's feature additions (env vars, steps). |
| **Source code** | `src/**/*.ts`, `src/**/*.tsx` | Analyze imports, function signatures, and logic paths. Prefer LMB's feature additions; apply branch's refactors on top. |
| **Docs / Config** | `README.md`, `*.config.*` | Keep both additions unless they contradict. |

For each file, produce a one-line resolution directive:
> `file.ts` → keep LMB's new API param, apply branch's error-handling refactor.

### Step 4: Present plan and wait for confirmation

Format:

```
## Dry-run Conflict Report
**Base:** origin/<lmb>  **Branch:** <name>  **Conflicts:** <N>

| File | Category | Proposed resolution |
|------|----------|---------------------|
...
```

Wait for explicit approval ("ok", "go", "proceed"). Do not rebase without confirmation.

### Step 5: Execute real rebase

Return to the original repository, start rebase:

```bash
cd "$ORIGIN"
git rebase "origin/${LMB}"
```

### Step 6: Resolve conflicts goal-oriented

Use the confirmed plan as the **target end-state**. For each conflict:

1. Read the file's conflict markers.
2. Do not mechanically pick "ours" or "theirs". Apply the confirmed directive to
   produce the correct merged content.
3. For lockfiles: delete the file and regenerate (`pnpm install`, `npm install`,
   etc.) rather than hand-editing conflict markers.
4. `git add <file>` after resolving.
5. `git rebase --continue` when all files in the current rebase step are clean.

If a new conflict appears in a later rebase commit that was NOT present in the
dry-run: apply the same category-based logic silently. Do not ask the user
unless the conflict involves an ambiguous business logic choice (e.g., two
mutually exclusive feature implementations in the same function body).

### Step 7: Verify and report

After rebase succeeds, run the verification script:

```bash
./scripts/verify-no-conflicts.sh
```

If it exits non-zero, resolve remaining markers and re-verify before reporting.

Clean up worktree:

```bash
git worktree remove "$WORKTREE" 2>/dev/null || rm -rf "$WORKTREE"
```

Report to user:
- Rebase completed successfully onto `origin/<lmb>`.
- List of commits now on the branch (top 5).
- Any files that required non-trivial manual merging (as a courtesy).
- Reminder to run tests/build before pushing.

</process>

<critical_rules>
- **Dry-run must precede real rebase.** Never start `git rebase` before completing
  the isolated merge analysis.
- **Always use worktree for dry-run.** Do not perform `--no-commit --no-ff` in
  the original working directory where it could pollute the working tree or
  interfere with the user's in-progress edits.
- **User confirmation is mandatory.** After presenting the plan, wait for
  explicit approval. "Looks good" or "ok" counts as approval. Silence does not.
- **Lockfiles are never hand-merged.** Delete and regenerate. Always.
- **Do not interrupt the user during rebase execution.** Once confirmed, resolve
  all conflicts autonomously using the agreed plan.
- **Prefer higher dependency versions** when merging `package.json` conflicts,
  unless the branch explicitly pins or downgrades for a known compatibility
  reason stated in the plan.
- **Keep both sides for CI workflows** unless the branch intentionally removes a
  step that LMB added.
</critical_rules>

<success_criteria>
- Dry-run worktree is created, analyzed, and cleaned up without side effects on
  the original repo.
- User receives a conflict report with per-file categories and proposed
  resolutions before any real rebase begins.
- Real rebase completes with zero remaining conflict markers.
- Branch history is linear on top of `origin/<lmb>`.
- User is not asked mid-rebase for routine conflict decisions.
</success_criteria>

<ask_user_instead_of_guessing>
- LMB cannot be inferred (neither `origin/master` nor `origin/main` exists).
- Dry-run reveals an ambiguous business logic conflict where both sides
  implement mutually exclusive behavior in the same function or API.
- The branch intentionally removes a workflow step or dependency that LMB added,
  and the intent is unclear.
- Regenerating the lockfile fails due to peer dependency incompatibilities.
</ask_user_instead_of_guessing>
