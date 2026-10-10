---
name: magicdoor-local-debug
description: >
  Use whenever MagicDoor work needs a local development or verification
  environment — frontend-only changes included: "本地起一套", "本地联调",
  起一个模块的验证环境, md up 失败, run the stack locally, test a module
  against local containers. ALL local dev goes through the local `md` stack;
  an npm-script dev server against the cloud backend is not a starting point.
---

# MagicDoor Local Debug — the md stack workflow

Local MagicDoor development runs on one thing: a local `md` stack — a complete
copy of the system with its own databases, Kafka topics and hostnames.
Frontend work is no exception: linking your checkout to the stack replaces the
frontend container with your own dev server (`md link`), pointed at the stack
automatically.

## The module workflow — always the same four steps

1. **UP** — minimal container set for the module under test:

   ```bash
   md up --stack <module> --only auth,files,portal,business,salesworkflows,subscriptions,communications,maintenance,leasing,settings,companies,accounting,payments,websockets<+,module services if any>
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
   when a page actually answers 502.
   module calls (mapping table in `references/module-workflow.md`) or a
   page proves them missing. The
   `--stack <module>` name matters: a stack name from an earlier session is
   **reused as-is** — databases are not re-restored and state is not fresh.
   All five frontend containers always start (accepted behavior of
   `--only`).
2. **LINK** — run `md link` from **two kinds of checkouts**:

   ```bash
   cd <portal checkout> && md link
   ```

   - **`internal-portal` always** (login entry point): its container is a
     static SPA baked for the deployed test env — its Sign In button jumps
     straight to real Google OAuth and the stack's email form never appears.
     Only the **linked dev server** carries the stack config that renders the
     "Local stack sign-in" form (internal-portal went static nginx in
     2026-09-13 #157). If the sign-in page shows a Google button instead of
     the email form, internal is still containerized — go back and link it.
   - **the portal you are working on**: its container is replaced by your dev
     server (`.env.local` written against `*.md.test`); `md unlink` hands it
     back.
3. **VERIFY** — register the target company host **first** (`md add-website
   <company>` — the shadow-login landing
   `<company>.with.<stack>.md.test` is not in /etc/hosts before this, and
   the shadow token expires in **1 minute**, so a DNS probe failure wastes
   the token too), then open `https://internal.<stack>.md.test` and sign in
   through
   the "Local stack sign-in" **email form** (it must be there — see above):
   use
   **`hao-ruan@magicdoor.com`** — that address exists in the stack database;
   any other address creates a brand-new full-permission employee and
   pollutes the stack. Pick the company → find the user row → **Shadow
   Login**. Full role-session procedure: `magicdoor-e2e` skill.
4. **NUKE** — when the module verification is done:

   ```bash
   md nuke <module>
   ```

   Containers are removed, the stack's databases are dropped, hostnames
   cleaned and the OAuth redirect port released. Shared base infrastructure
   stays up by design — never touch it. Leaving a module stack behind
   exhausts the pooled OAuth redirect ports; module stacks are
   created-and-destroyed, not accumulated.

## Common Mistakes (observed in real incidents)

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
- **"Fresh" test with an existing stack name** — it resumes old databases.
  A fresh module run starts from `--stack <new-name>`.
- **Full `md up` for one module** — pulls all 23 service images and restores
  every database; `--only` also scopes the staging restore.
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