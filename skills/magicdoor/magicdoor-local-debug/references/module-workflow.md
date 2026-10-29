# The frontend round on a local stack (detailed)

Step-by-step detail behind `SKILL.md`'s four steps, for work that takes a
frontend over. The canonical commands and the baseline service list live in
`SKILL.md` — this file does not repeat them.

## Step 1 — UP: what the flags mean

`md doctor` checks Docker memory (≥8 GB), registry login, hosts file and DB
credentials before anything costs time.

- **`--only`** scopes backend services only: no registry check, no pull, no
  database, no staging restore for anything outside the list. All five frontend
  containers still start, by design — internal-portal is the Shadow Login entry.
- **`--stack hao-local-debug`** keeps every module, checkout and branch on the
  same containers, databases, hostnames and certificate. Keys are
  case-insensitive; write them lowercase (the App directory names).
- **Data**: only new-or-empty databases are restored from staging, which is why
  restarting the persistent stack costs nothing over the wire. `--no-data` skips
  the restore. Schema moved on without the data → `md migrate`; data rotted →
  `md reset --data`.
- **Images**: a bare `md up` reuses the pinned digests. First-ever pull of the
  full 23-image set is ≈2.4 GB (`frauddetection` alone 1.4 GB); each service's
  own layers are small (median ≈17 MB) and shared base layers download once.

## Step 2 — LINK: internal-portal always, plus the one you change

```bash
cd <portal checkout>
md link        # container → your dev server; writes .env.local, starts vite
md status      # confirm the frontend shows as linked
md unlink      # hand it back to the container when done
```

- **`internal-portal` — every stack, even a frontend-only run.** Since
  2026-09-13 (#157) it is a static nginx SPA with the deployed-env config baked
  at build time, so as a container its "Sign In with Google" jumps to real
  `accounts.google.com` and the stack's email form never appears. The sign-in
  page shows the Google button **regardless of link state** (`SignIn.tsx` has no
  email form); the linked dev server only changes where the **click** goes
  (verified 2026-10-10 and again 2026-10-11: container → Google jump; linked →
  form at `auth.hao-local-debug.md.test/internal/local-login`, because the
  stack's auth has no `GOOGLE_OAUTH_CLIENT_ID`).
- **The portal you are working on** — changes ship through your dev server, HMR
  live against the stack.

For the linked ones:

- The stack hostname keeps working and now reaches the dev server; Shadow Login
  lands there too — the point of the step.
- A package export error means stale dependencies:
  `pnpm install --frozen-lockfile` inside the worktree.
- A dev server that proxies to `*.md.test` over HTTPS needs the mkcert root CA:
  start it with `NODE_EXTRA_CA_CERTS=$HOME/.local/share/mkcert/rootCA.pem`, or
  every proxied API call fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (visible as
  a 502 in the browser; system `curl` is unaffected).
- Owner and tenant portals need the **https** company host
  (`https://<company>.with.hao-local-debug.md.test/owners`). Over plain http
  `window.isSecureContext` is false, `crypto.subtle` does not exist, and
  magic-link login throws at the PKCE step and drops back to `/login` — the auth
  log shows no `/oauth/authorize` at all.

## Step 3 — VERIFY through Internal Portal + Shadow Login

0. **Register the shadow-login landing host first:** `md add-website <company>`.
   Shadow sessions land on `<company>.with.hao-local-debug.md.test`, which
   `/etc/hosts` does not carry until this runs (default is `hogwarts` only). A
   DNS probe failure there burns the shadow token — it expires in **1 minute** —
   and the internal-portal round has to be redone.
1. Open `https://internal.hao-local-debug.md.test`.
2. **Health check is the click, not the button:** it must land on the "Local
   stack sign-in" email form. A jump to real `accounts.google.com` means
   internal-portal is still containerized → Step 2.
3. Sign in via the email form (stacks replace Google OAuth because `.test`
   redirect URIs are rejected) as **`hao-ruan@magicdoor.com`**.
4. Companies list → open the company → Property Managers / Tenants / Owners /
   Vendors tabs → **`Shadow Login`** on the user row. The portal opens in a new
   tab already signed in as that user.
5. Full procedure — tabs, the `?tabId=vendors` back door, the HOA host hop, every
   pitfall: `magicdoor-e2e` skill.

Reaching the Companies list proves the whole chain (OAuth → token → jwks → API)
works. An API 500/401 from here is usually addressing or proxy:
`references/md-deep-reference.md` troubleshooting.

## Step 4 — DOWN

```bash
md down --stack hao-local-debug
```

Containers, linked dev servers and the proxy stop. Databases, `/etc/hosts`
entries, certificates and pinned digests stay, so the next `md up` returns the
same stack in seconds. The base infrastructure
(`magicdoor-postgres/kafka/zookeeper/redis/milvus/proxy`) is always-on furniture
and never touched.

## Module → backend services map

Baseline for **every** module is the fixed 14-service set in `SKILL.md` step 1,
with internal-portal linked. Add rows as modules are verified; keep the verified
date honest.

| Module / surface | Extra services (`--only` additions) | Verified |
|---|---|---|
| full tenant-portal E2E round (login → shadow-login → tenant pages/figures) | none — covered by the baseline | 2026-10-10 (8-grow real run; companies list, shadow chain and figures all OK) |
| vendor-portal work-orders & bills | covered by baseline `maintenance` | 2026-10-10 (vendor checkout: `workOrdersRepository` → `maintenanceServiceUrl`) |
| HOA boards / votes / architectural requests (owner or manager side) | `hoa` | 2026-10-29 (owner-portal HOA round; `hoa` there was branch code under `md host`, so the master image is unverified for these pages) |
| anything with file upload/list | covered by baseline `files` | — |
| *others* | fill in as verified | — |

**How to discover a module's services** (before adding a row):

1. Grep the portal checkout's repositories layer for the service URL each
   repository calls (`maintenanceServiceUrl()`, `portalServiceUrl()`, …) and the
   path prefix it hits (`/vendor-portal/work-orders`).
2. Cross-check swagger groups per service with `magicdoor-backend-swagger`
   (`magicdoor-env -e test -s <service> -a`).
3. When unsure at test time, watch the browser network tab against the deployed
   test environment once and note which `services.<domain>/<x>` prefixes fire —
   those are the `--only` additions.
