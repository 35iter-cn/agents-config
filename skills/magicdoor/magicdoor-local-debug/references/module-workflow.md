# Module workflow on a local stack (detailed)

The four steps in depth: UP → LINK → VERIFY → NUKE. One module under test,
one stack, created fresh and destroyed after.

## Step 1 — UP

```bash
md doctor                                  # first thing, every session
md up --stack <module> --only auth,files,portal,business,salesworkflows,subscriptions,communications,maintenance,leasing,settings,companies,accounting,payments,websockets
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
- **`--stack <module>`**: the stack's default name comes from the git branch
  and is then fixed to the checkout. Naming per module gives you a fresh
  namespace per test and lets different modules coexist in one checkout
  without colliding. If a previous run used the same name, it is reused —
  not re-created; drop it first with `md nuke <name>`. Keys are
  case-insensitive, but write them lowercase (the App directory names).
- **`--only`** scopes backend services only: no registry check, no pull, no
  database, no staging restore for anything outside the list. All five
  frontend containers still start (by design; internal portal is the
  Shadow Login entry).
- **Data**: newly created (or empty) databases are restored from staging on
  this run — a fresh stack arrives at master's schema with real test data.
  `--no-data` skips it entirely when the module needs no DB state.
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
2. Re-run `md up --stack <module> --only <previous services> + <the missing
   one>` and let the new containers come up.
3. Re-verify the page.

**Never shrink the list in place.** compose regenerates with
`--remove-orphans`, so every container outside the new list is torn down. To
run fewer services: `md nuke <module>` and start a fresh stack with the
smaller list.

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
  email form never appears. The linked dev server injects the stack config,
  and only then the "Local stack sign-in" form renders (verified 2026-10-10:
  container → Google jump; linked → form at
  `auth.<stack>.md.test/internal/local-login`).
- **The portal you are working on** — changes ship through your dev server,
  HMR live against the stack.

Everything else stays as containers. Three notes for the linked ones:

- The stack hostname (e.g. `portal.<stack>.md.test`,
  `internal.<stack>.md.test`) keeps working and now reaches the linked dev
  server; the Shadow Login lands there too — the point of Step 2.
- `node_modules` freshness applies exactly as on any dev server: a package
  export error means stale dependencies — `pnpm install --frozen-lockfile`,
  inside the worktree.

## Step 3 — VERIFY through Internal Portal + Shadow Login

0. **Register the shadow-login landing host:** `md add-website <company>`.
   Shadow sessions land on `<company>.with.<stack>.md.test`, which is only
   written to `/etc/hosts` by add-website (default is `hogwarts` only); a
   DNS_PROBE there burns the shadow token — it expires in **1 minute** —
   and the whole internal-portal round has to be redone. Do it before
   signing in.
1. Open `https://internal.<stack>.md.test`.
2. **Health check:** you must land on the "Local stack sign-in" **email
   form**. If you see a "Sign In with Google" button that jumps to real
   Google, internal-portal is still running as a container — go back to
   Step 2 and link it before anything else.
3. Sign in via the email form (stacks replace Google OAuth because `.test`
   redirect URIs are rejected): enter **`hao-ruan@magicdoor.com`**.
4. Companies list → open the company → tabs for Property Managers /
   Tenants / Owners / Vendors → click **`Shadow Login`** on the user row.
   A new tab opens the target portal already signed in as that user.
5. Detailed flow, the `?tabId=vendors` back door for hidden tabs, the HOA
   host hop, and every pitfall: `magicdoor-e2e` skill. The stack-specific
   difference from the deployed environments is the email-form sign-in
   above; shadow-logins land on `*.<stack>.md.test` hosts (a **linked**
   portal lands on your dev server — the point of Step 2).

Reaching the Companies list proves the whole chain (OAuth → token → jwks →
API) works; an API 500/401 from here is usually an addressing/proxy problem —
`md doctor`, see `references/md-deep-reference.md` troubleshooting.

## Step 4 — NUKE

```bash
md nuke <module>
```

What it destroys for that stack: containers, the stack's databases (dropped
in the shared Postgres), hostnames written to `/etc/hosts`, and the pooled
OAuth redirect port. What it does **not** touch: the base infrastructure
stack (`magicdoor-postgres/kafka/zookeeper/redis/milvus/proxy`) and its
volumes — shared singletons every module stack depends on. Module stacks
are created-and-destroyed per test; the base is always-on furniture.

If the next test is the same module on new code: nuke the old one, then
`md up --stack <module> --only …` again — the databases re-restore, the
flow restarts clean.

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