# Module workflow on a local stack (detailed)

The four steps in depth: UP → LINK → VERIFY → DOWN. One module under test,
one long-lived stack (`hao-local-debug`) whose databases are reused.

## Step 1 — UP

```bash
md doctor                                  # first thing, every session
md up --stack hao-local-debug --only auth,files,portal,business,salesworkflows,subscriptions,communications,maintenance,leasing,settings,companies,accounting,payments,websockets
```

- **`md doctor`** checks Docker memory (≥8 GB), registry login, hosts file and
  DB credentials — before anything costs time.
- **Baseline = 14 services, in one shot.** Observed across a full
  tenant-portal E2E round (2026-10-10), which grew its `--only` list eight
  hops before settling on exactly this set:
  `auth, files, portal` (Shadow Login entry + its API) + `business,
  salesworkflows, subscriptions, communications, maintenance, leasing,
  settings, companies, accounting, payments, websockets` (the dependency
  chain a real shadow-login round exercised, one layer at a time:
  portal → leasing → accounting → …). Do not rediscover this list page by
  page; start all 14 and keep the grow loop for the truly unexpected. The
  9 services that stay out until evidence: `ai, audits, documenttemplates,
  education, frauddetection, hoa, productexperiences, tenantinsurance,
  webhooks` — note `frauddetection` (1.4 GB wire) sits out by default.
- **`--stack hao-local-debug`**: without it the name comes from the git
  branch and is then bound to the checkout, so a worktree or an unfamiliar
  checkout gets a second stack — 23 images pulled across the border and 14
  databases restored again. With it, every module, every checkout and every
  branch lands on the same containers, databases, hostnames and certificate.
  Keys are case-insensitive, but write them lowercase (the App directory
  names).
- **`--only`** scopes backend services only: no registry check, no pull, no
  database, no staging restore for anything outside the list. All five
  frontend containers still start (by design; internal portal is the
  Shadow Login entry).
- **Data**: only newly created (or empty) databases are restored from
  staging. A database that already has tables is never touched, which is why
  a restart of the persistent stack costs nothing over the wire. `--no-data`
  skips the restore entirely. Schema moved on without the data? See
  `md migrate` / `md reset --data` in `SKILL.md`.
- **Images**: bare `md up` reuses what is pinned and skips the registry
  unless an image's last check is ≥24 h old, a pin is missing locally, or
  you pass `-r/--refresh`. First-ever pull of the full set is ≈2.4 GB
  (`frauddetection` alone 1.4 GB); each service's own layers are small
  (median ≈17 MB) and shared base layers are downloaded once.

### Grow on demand — the standard way to add a missing service

`md up --only <superset>` re-run is additive and idempotent: existing
containers stay up, new ones come up. When a page answers **502** or a fetch
fails, the service behind it is not in the current stack:

1. Grep the portal checkout's route table for the failing request prefix
   (`viteProxy.ts` / `vite.stack.config.ts` / `appProxy.ts`) to name the
   service — e.g. `/api/internal → portal-backend`; use the failing URL from
   the browser network tab as the grep term.
2. Re-run `md up --stack hao-local-debug --only <previous services> + <the missing
   one>` and let the new containers come up.
3. Re-verify the page.

**Never shrink the list in place.** compose regenerates with
`--remove-orphans`, so every container outside the new list is torn down. If
you do shrink the list, only the containers go — the databases survive, and
re-running with the full list brings those services straight back.

Grow noise note: business/salesworkflows used to be "fixed noise" on a
minimal stack — that is obsolete with the 14-service baseline; only
`ai, audits, documenttemplates, education, frauddetection, hoa,
productexperiences, tenantinsurance, webhooks` remain out until evidence.

## Step 2 — LINK frontends: internal-portal always, plus the one you change

```bash
cd <portal checkout>
md link        # container → your dev server; writes .env.local, starts vite
md status      # confirm the frontend shows as linked
md unlink      # hand it back to the container when done
```

**Always-link list:**

- **`internal-portal` — every stack, even a frontend-only run.** Since
  2026-09-13 (#157) it is a static nginx SPA with the deployed-env config
  baked at build time; as a container its "Sign In with Google" jumps to
  real `accounts.google.com` (redirect URI = deployed auth) and the stack's
  email form never appears. The sign-in page shows the Google button
  **regardless of link state** (`SignIn.tsx` has no email form); the
  linked dev server only changes where the **click** goes (verified
  2026-10-10, re-verified 2026-10-11: container → Google jump; linked →
  form at `auth.hao-local-debug.md.test/internal/local-login`, because the stack's
  auth has no `GOOGLE_OAUTH_CLIENT_ID`).
- **The portal you are working on** — changes ship through your dev server,
  HMR live against the stack.

Everything else stays as containers. Three notes for the linked ones:

- The stack hostname (e.g. `portal.hao-local-debug.md.test`,
  `internal.hao-local-debug.md.test`) keeps working and now reaches the linked dev
  server; the Shadow Login lands there too — the point of Step 2.
- `node_modules` freshness applies exactly as on any dev server: a package
  export error means stale dependencies — `pnpm install --frozen-lockfile`,
  inside the worktree.

## Step 3 — VERIFY through Internal Portal + Shadow Login

0. **Register the shadow-login landing host:** `md add-website <company>`.
   Shadow sessions land on `<company>.with.hao-local-debug.md.test`, which is only
   written to `/etc/hosts` by add-website (default is `hogwarts` only); a
   DNS_PROBE there burns the shadow token — it expires in **1 minute** —
   and the whole internal-portal round has to be redone. Do it before
   signing in.
1. Open `https://internal.hao-local-debug.md.test`.
2. **Health check:** the sign-in page always shows **"Sign In with
   Google"** — that is normal either way. The check is the click: on a
   stack it must land on the "Local stack sign-in" **email form** at
   `auth.hao-local-debug.md.test/internal/local-login`. A click that jumps to real
   `accounts.google.com` means internal-portal is still running as a
   container — go back to Step 2 and link it before anything else.
3. Sign in via the email form (stacks replace Google OAuth because `.test`
   redirect URIs are rejected): enter **`hao-ruan@magicdoor.com`**.
4. Companies list → open the company → tabs for Property Managers /
   Tenants / Owners / Vendors → click **`Shadow Login`** on the user row.
   A new tab opens the target portal already signed in as that user.
5. Detailed flow, the `?tabId=vendors` back door for hidden tabs, the HOA
   host hop, and every pitfall: `magicdoor-e2e` skill. The stack-specific
   difference from the deployed environments is the email-form sign-in
   above; shadow-logins land on `*.hao-local-debug.md.test` hosts (a **linked**
   portal lands on your dev server — the point of Step 2).

Reaching the Companies list proves the whole chain (OAuth → token → jwks →
API) works; an API 500/401 from here is usually an addressing/proxy problem —
`md doctor`, see `references/md-deep-reference.md` troubleshooting.

## Step 4 — DOWN

```bash
md down --stack hao-local-debug
```

Stops the containers, stops the linked frontend dev servers and detaches the
proxy. Databases, hostnames in `/etc/hosts`, certificates and pinned image
digests all stay, so the next `md up` returns the same stack in seconds.
The base infrastructure (`magicdoor-postgres/kafka/zookeeper/redis/milvus/
proxy`) runs as always-on furniture and is never touched.

For different data rather than a different stack, `md reset --data --stack
hao-local-debug` drops and re-restores the databases. `md nuke` — which also
drops the databases, the hosts entries and the pooled OAuth port — is for a
branch with a destructive migration, on a scratch stack name.

## Module → backend services map

Baseline for **every** module: the fixed **14-service set** (see Step 1,
observed via a full tenant E2E round 2026-10-10) with the internal portal
frontend as a linked dev server, always running. Add rows as modules are
verified; keep the verified date honest.

| Module / surface | Backend services (`--only` value) | Verified |
|---|---|---|
| full tenant-portal E2E round (login → shadow-login → tenant pages/figures) | the fixed 14: `auth,files,portal,business,salesworkflows,subscriptions,communications,maintenance,leasing,settings,companies,accounting,payments,websockets` | 2026-10-10 (inductive: 8-grow real run; companies list + shadow chain + figures all OK on this set) |
| vendor-portal work-orders & bills | `maintenance` | 2026-10-10 (vendor checkout: workOrdersRepository → maintenanceServiceUrl, `.magicdoorc` spec VendorApp/VendorPortal) |
| anything with file upload/list | covered by baseline `files` | — |
| *others* | fill in as verified | — |

**How to discover a module's services** (use this before adding a row):

1. In the portal checkout, grep the repositories layer for the service URL
   each repository calls (`maintenanceServiceUrl()`, `portalServiceUrl()`,
   …) and the path prefix they hit (`/vendor-portal/work-orders`).
2. Cross-check swagger groups per service with `magicdoor-backend-swagger`
   (`magicdoor-env -e test -s <service> -a`).
3. When unsure at test time, watch the browser network tab against the
   deployed test environment once and note which `services.<domain>/<x>`
   prefixes fire — those are the `--only` entries.