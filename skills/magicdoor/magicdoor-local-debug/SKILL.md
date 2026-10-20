---
name: magicdoor-local-debug
description: >
  Use whenever MagicDoor work needs a local development or verification
  environment — frontend-only changes included: "本地起一套", "本地联调",
  起一个模块的验证环境, md up 失败, run the stack locally, test a module
  against local containers, 本地库 schema 落后要 migrate. ALL local dev goes
  through the one persistent `hao-local-debug` stack; an npm-script dev server
  against the cloud backend is not a starting point.
---

# MagicDoor Local Debug — one persistent md stack

Local MagicDoor development runs on one thing: a local `md` stack — a complete
copy of the system with its own databases, Kafka topics and hostnames.
Frontend work is no exception: linking your checkout to the stack replaces the
frontend container with your own dev server (`md link`), pointed at the stack
automatically.

## The stack is `hao-local-debug`, and it stays

Every `md` command carries `--stack hao-local-debug`:

```bash
md up --stack hao-local-debug --only <services>
md down --stack hao-local-debug
md migrate --stack hao-local-debug
```

Without the flag, a stack's name is derived from the branch and then bound to
whichever checkout you stand in — so a worktree, or a checkout you have never
used for `md`, silently gets a **second** stack: 23 images pulled across the
border again and 14 databases restored from staging again. That is the slowest
thing in this workflow, and the flag is what avoids it.

The stack is long-lived. Containers, databases, hostnames, certificates and
Kafka topics survive between sessions:

- **`md down` ends a session** — containers stop, databases and hostnames stay
  untouched, and the next `md up` brings the same stack back with its data.
- **`md nuke` is not a routine step.** The two things it buys — a fresh
  data baseline and freed OAuth redirect ports — are covered by
  `md reset --data` and by using exactly one stack. Reserve it for the one
  case in "Data and schema" below.
- **Do not run `docker image prune` on the service images.** They are the local
  cache that makes every later `md up` instant.

## The workflow — four steps

1. **UP** — the same full service list, every time:

   ```bash
   md up --stack hao-local-debug --only auth,files,portal,business,salesworkflows,subscriptions,communications,maintenance,leasing,settings,companies,accounting,payments,websockets<+,module services if any>
   ```

   Backend baseline is a fixed set of **14 services**, observed across a
   full tenant-portal E2E round (2026-10-10): `auth, files, portal` (login
   entry + its API) plus `business, salesworkflows, subscriptions,
   communications, maintenance, leasing, settings, companies, accounting,
   payments, websockets` (the dependency chain a real shadow-login round
   exercised). Start all 14 in one shot — do not discover them page by
   page. Module-specific extras go after. The only services that stay out:
   `ai, audits, documenttemplates, education, frauddetection, hoa,
   productexperiences, tenantinsurance, webhooks` — add via the grow loop
   when a page actually answers 502. All five frontend containers always
   start (accepted behavior of `--only`).
2. **LINK** — run `md link` from **two kinds of checkouts**:

   ```bash
   cd <portal checkout> && md link
   ```

   - **`internal-portal` always** (login entry point): its container is a
     static SPA baked for the deployed test env — its Sign In button jumps
     straight to real Google OAuth and the stack's email form never appears.
     **The sign-in page always shows a "Sign In with Google" button, linked
     or not** (`SignIn.tsx` has no email form; internal-portal went static
     nginx in 2026-09-13 #157). The check is the **click** (verified
     2026-10-11): clicking it redirects to the auth host — on a stack the
     linked app hits the local auth, which has no `GOOGLE_OAUTH_CLIENT_ID`
     and so renders the "Local stack sign-in" email form at
     `auth.hao-local-debug.md.test/internal/local-login`; a jump to real
     `accounts.google.com` means internal is still containerized — go back
     and link it. A Google button on the sign-in page is therefore normal,
     not a linked-state symptom.
   - **the portal you are working on**: its container is replaced by your dev
     server (`.env.local` written against `*.md.test`); `md unlink` hands it
     back.
3. **VERIFY** — register the target company host **first** (`md add-website
   <company>` — the shadow-login landing
   `<company>.with.hao-local-debug.md.test` is not in /etc/hosts before this, and
   the shadow token expires in **1 minute**, so a DNS probe failure wastes
   the token too), then open `https://internal.hao-local-debug.md.test` and sign in
   through
   the "Local stack sign-in" **email form** (it must be there — see above):
   use
   **`hao-ruan@magicdoor.com`** — that address exists in the stack database;
   any other address creates a brand-new full-permission employee and
   pollutes the stack. Pick the company → find the user row → **Shadow
   Login**. Full role-session procedure: `magicdoor-e2e` skill.
4. **DOWN** — when the verification is done:

   ```bash
   md down --stack hao-local-debug
   ```

   Containers stop, linked frontend dev servers stop, the proxy detaches.
   The databases, hostnames and pinned images stay exactly as they were.
   Next session starts at step 1 and is ready in seconds.

## Data and schema — reuse, migrate, rarely rebuild

The databases are the expensive part of a stack (a cross-border `pg_dump`
per service), so the default is to keep them:

- **Reuse is automatic.** `md up` restores only databases it just created or
  found empty; a database that already has tables is never touched, and `md up`
  says so (`every database already has data`).
- **Code ahead of the local schema → `md migrate --stack hao-local-debug`**,
  run from the backend checkout that carries the migration (it applies that
  checkout's EF projects). This is the normal path when master moves on, and
  the only path needed when your branch adds a migration.
- **Rebuild the data** with `md reset --data --stack hao-local-debug`: it drops
  and re-restores the stack databases from staging — the one place the
  cross-border cost is paid deliberately. Do this when data has rotted (stale
  test rows, half-finished flows) or after a destructive migration.
- **Never substitute mock data for the staging restore.** The dump's value is
  not its volume: it carries the `custom_domain` clearing that keeps generated
  URLs on this stack, plus the `hogwarts` company and the
  `hao-ruan@magicdoor.com` employee row that Shadow Login needs. Hand-built
  seed data breaks that chain and buys nothing.
- **The one `md nuke` case:** a branch whose migration is destructive (drops
  or renames columns, adds NOT NULL without a default) runs against a scratch
  stack, never against `hao-local-debug` — those changes cannot be undone by
  restoring later. Verify there, then `md nuke <scratch name>`.

## Images — don't re-pull what you already have

- Images are pinned by digest and re-checked at most once per 24 h, so a plain
  `md up` does not talk to the registry at all. Restarting the stack costs
  nothing over the wire.
- The cross-border pull happens only on `-r`/`--refresh`, `--from <tag>`, or
  `md reset --images`. Use one of them when the backend code you are verifying
  actually changed — and keep the **full** `--only` list while doing it,
  because compose runs with `--remove-orphans` and any service you drop from
  the list is torn down.
- `md up --from <branch-tag>` takes the image built from that branch, which is
  what you want over `:newest` when verifying your own backend work.

## Common Mistakes (observed in real incidents)

- **`md` without `--stack hao-local-debug` from a worktree or another checkout**
  — a new branch-named stack appears, and the next `md up` pulls 23 images and
  restores 14 databases from scratch. Always name the stack.
- **Starting a "fresh" test by nuking** — use `md reset --data`; it refreshes
  the data without dropping the hosts entries and the pooled OAuth port.
- **Module page answers 502** — rare now: the 14-service baseline covers a
  full E2E round. If it still happens, identify the service from the
  frontend's route config, then
  **grow** the list and re-run `md up --only` (additive and idempotent);
  do not guess service names by trial, and never shrink the list in place
  (`--remove-orphans` deletes anything outside it).
- **Signing in through the containerized internal portal** — its static SPA
  is built with deployed-env config, so the Google button jumps to
  `accounts.google.com` (redirect URI = deployed auth) instead of the stack
  email form. On a stack, `internal-portal` must be **linked**.
- **Full `md up` with no `--only`** — starts all 23 services (including
  `frauddetection`, 1.4 GB) instead of the 14 the work needs.
- **Dev server fails on a package export error** → stale `node_modules`
  (`pnpm install --frozen-lockfile`); applies to linked frontends too.
- **Reaching for `vite build` + preview + faked environments** (`VITE_MD_STACK_DOMAIN`,
  `/etc/hosts` hacks) instead of the stack — wrong; a linked dev server
  already targets the stack and its localhost port is whitelisted.
- **Editing `~/.magicdoor/src`** (the managed CLI checkout — replaced on
  update). Clone and point `MD_CLI_SOURCE` at the clone instead.

## References

- `references/module-workflow.md` — the detailed four-step workflow and the
  module → backend services map.
- `references/md-deep-reference.md` — one-time setup, IDE breakpoints on one
  backend service (`md host`/`md unhost`), addressing rules, full
  troubleshooting.

## Related

| Skill | Role |
|---|---|
| `magicdoor-e2e` | Shadow Login details: company selection, tabs, pitfalls |
| `magicdoor-backend-swagger` | service URLs and swagger group lookup (`magicdoor-env`) |
