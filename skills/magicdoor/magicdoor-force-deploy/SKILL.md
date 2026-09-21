---
name: magicdoor-force-deploy
description: Use when the user asks to force-push a branch to a MagicDoor frontend repo's dev or staging branch to trigger the environment build and run smoke tests. Covers branch preflight (existence + dedicated deploy workflow), local backup ref, and the push + deploy-confirmation loop. Do not use for normal PR pushes or production deploys.
---

# Force Deploy to dev/staging Environment

## Overview

Force-pushing `dev` or `staging` on MagicDoor frontend repos is pre-authorized by the user: these branches exist only to trigger environment builds, both environments allow unconditional overwrite, and the backup ref is the only safety net (recovery is on-demand, rarely needed). Preflight is two cheap checks, then push immediately — no second user confirmation, no safety essay.

## Environment map (company-portal)

| Branch | Workflow | Deployed URL | Version check |
|---|---|---|---|
| `dev` | `deploy-to-dev-env.yaml` | `https://portal.magicdoor.dev` | `<meta name="build-version">` + `build-commit` |
| `staging` | test-env deploy workflow | `https://portal.magicdoor-test.com` | same |

`build-commit` must equal the pushed short sha. Sentry: environment from hostname (`getEnv()`), project `portal-frontend`, org slug `sentry`.

## Steps

### 1. Preflight

Run from the target worktree (both checks in one pass):

1. `git ls-remote --heads origin <branch>` — branch must exist on origin.
2. `gh api repos/<owner>/<repo>/actions/workflows` (or read `.github/workflows/`) — confirm a deploy workflow triggers on push to that branch. No dedicated workflow = stop and report.

### 2. Backup (mandatory, non-negotiable)

Before any push, capture the current origin head so the overwrite is always reversible:

```bash
git fetch origin <branch>
git branch backup/<branch>-pre-<YYYYMMDD> origin/<branch>
```

Verify the old head is reachable: `git cat-file -t origin/<branch>` → must print `commit`. Record the rollback one-liner:

```bash
git push origin backup/<branch>-pre-<YYYYMMDD>:<branch>
```

Skip creating the backup branch only if an equivalent ref for the current origin head already exists locally.

### 3. Push immediately

Checks passed → push at once, no further user confirmation:

```bash
git push --force-with-lease=origin/<branch>:<old-sha> origin <local-branch>:<branch>
```

`<local-branch>` is usually the topic worktree's feature branch or a rebase result. `--force-with-lease` pins the sha seen during preflight.

### 4. Confirm deploy

1. `gh run list --branch <branch> --limit 1` → get run id; `gh run watch <id> --exit-status`.
2. Poll the deployed URL until `<meta name="build-version">`/`build-commit` shows the new short sha (typ. 2–5 min).
3. Version confirmed → hand off to `magicdoor-e2e` for smoke tests. Report: pushed sha, run id, deployed version, rollback command.

## Pitfalls

- Do NOT re-litigate the overwrite: no orphan-commit archaeology, no risk essays, no "are you sure". Backup ref is the safety net.
- `--force-with-lease` requires the fetched `origin/<branch>`; if someone pushed in between, the lease rejects — refetch, re-backup if head moved, re-push.
- After deploy, stale tabs on the old bundle may not be reloaded by version ping (known observation, do not block).