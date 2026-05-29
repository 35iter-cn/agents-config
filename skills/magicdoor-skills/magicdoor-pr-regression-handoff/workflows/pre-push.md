# Pre-push Checks

<objective>
Run project-appropriate pre-push checks before any branch push. Detect the project type from repository files, execute the matching checks, and stop immediately if any executed check fails.
</objective>

<execution_context>
This workflow is called from `@./create-pr.md` and `@./update-pr.md` before `git push origin {branch}`.
</execution_context>

<process>
### Step 1 - Detect Project Type

Probe files in this priority order and stop at the first match:

1. `package.json`
2. `go.mod`
3. `Cargo.toml`
4. `pyproject.toml`
5. `Makefile`
6. No known project file found

### Step 2 - Run Matching Checks

If `package.json` exists:
- Probe script names from `package.json` before running them, for example by reading the `scripts` object keys.
- Choose the script runner from project lockfiles: `pnpm-lock.yaml` -> `pnpm`, `yarn.lock` -> `yarn`, otherwise use `npm`.
- Run checks in this order: `format`, `lint`, `type-check`.
- Execute each available script with the detected runner, for example `{runner} run format`, `{runner} run lint`, `{runner} run type-check`.
- Skip missing scripts with a warning.

If `go.mod` exists:
- Run `go fmt ./...`
- Then run `go vet ./...`

If `Cargo.toml` exists:
- Run `cargo fmt --check`
- Then run `cargo check`

If `pyproject.toml` exists:
- Probe each tool before running it.
- Run `ruff check .` when `ruff` is available.
- Run `black --check .` when `black` is available.
- Run `mypy .` when `mypy` is available.
- Skip missing tools with warnings.

If `Makefile` exists:
- Probe each target with `make -n <target> 2>/dev/null`.
- Run targets in this order: `format`, `lint`, `check`.
- Skip missing targets with warnings.

If none of the project files exist:
- Warn that no known pre-push checks were detected.
- Proceed without running checks.

### Step 3 - Report Outcome

Report which checks ran, which checks were skipped, and which checks passed.

If any executed check fails, stop immediately, report the failing command, and do not continue to push or PR steps.
</process>

<critical_rules>
- Detection order is mandatory: `package.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `Makefile`, then none.
- Execute checks only for the first detected project type.
- Keep the execution order inside each project type exactly as defined above.
- Skipped scripts, tools, or targets require warnings, not silent omission.
- Any executed check failure stops the parent workflow.
</critical_rules>

<success_criteria>
- The workflow reports the detected project type.
- The workflow reports which checks passed, failed, or were skipped.
- No push or PR operation proceeds after a failed executed check.
- The workflow remains English only and reusable from both PR flows.
</success_criteria>
