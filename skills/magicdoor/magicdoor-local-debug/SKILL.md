---
name: magicdoor-local-debug
description: >
  Use whenever MagicDoor work needs a local development or verification
  environment — frontend changes, backend branch code, and data/schema alike:
  "本地起一套", "本地联调", 起一个模块的验证环境, md up 失败, run the stack
  locally, test a module against local containers, 本地验证后端分支代码,
  backend branch code on the stack, md host, 本地库 schema 落后要 migrate.
  ALL local dev goes through the one persistent `hao-local-debug` stack; an
  npm-script dev server against the cloud backend is not a starting point.
---

# MagicDoor Local Debug — one persistent md stack

A stack is a complete copy of MagicDoor on this machine: every service, its own
databases, Kafka topics and hostnames. Development on it means one thing —
**take over the piece you changed** and leave every other container serving its
published image.

## Decide first: what are you taking over?

| Your diff touches | What serves it today | Take it over with |
|---|---|---|
| `Apps/<Service>/` — backend code | a container running a **master** image | `md host <service>`, your own process answers |
| a frontend's `src/` | a container | `md link` from that checkout |
| `Data/*.EntityFramework` — a migration | container Postgres | `md migrate --stack hao-local-debug` |
| nothing — you are verifying shipped behaviour | containers | nothing |

The predicate is the **diff**, not the symptom. `md` only ever runs registry
images of **master**, so a branch's backend code is in none of them: an endpoint
that 404s while your branch adds it is the stack behaving correctly. The answer
is `md host <service>` (step 2), never a self-built image — md has no notion of
one, and a `compose.override.yml` that swaps an image is not carried by `md up`.

## The stack is `hao-local-debug`, and it stays

Every `md` command carries `--stack hao-local-debug`. Without it the name is
derived from the git branch and then bound to whichever checkout you stand in, so
a worktree or an unfamiliar checkout silently gets a **second** stack: 23 images
pulled across the border and 14 databases restored from staging. That is the
slowest thing in this workflow, and the flag is what avoids it.

The stack is long-lived — containers, databases, hostnames, certificates and Kafka
topics all survive between sessions. **`md down` ends a session**: containers and
linked dev servers stop, data and pinned digests stay, the next `md up` is ready
in seconds. **`md nuke` is not routine** — `md reset --data` refreshes the data
and the single-stack convention keeps the OAuth redirect ports free; reserve nuke
for the one destructive-migration case below. **Do not `docker image prune` the
service images**: they are the cache that makes every later `md up` instant.

## The workflow — four steps

### 1. UP — the same full list, every time

```bash
md doctor      # Docker memory, registry login, hosts file, DB credentials
md up --stack hao-local-debug --only auth,files,portal,business,salesworkflows,subscriptions,communications,maintenance,leasing,settings,companies,accounting,payments,websockets
```

Those 14 are the baseline **every** module starts from: the login entry plus its
API, then the dependency chain a real shadow-login round exercises. Nine
services stay out until evidence: `ai, audits, documenttemplates, education,
frauddetection, hoa, productexperiences, tenantinsurance, webhooks`.

**`--only` is a full list, never a delta.** compose runs with
`--remove-orphans`, so a re-run naming one service tears the other 15 down. To
add one, append it to the full list and re-run:

```bash
md up --stack hao-local-debug --only auth,files,portal,business,salesworkflows,subscriptions,communications,maintenance,leasing,settings,companies,accounting,payments,websockets,hoa
```

Grow on **evidence only** — a page answers 502 or a fetch fails, and the portal's
route table (`appProxy.ts` / `viteProxy.ts`) names the service. Never discover
names by guessing, and never shrink the list in place.

### 2. TAKE OVER — one axis per change

**Frontend → `md link`**

```bash
cd <portal checkout> && md link   # container → your dev server, .env.local written against the stack
md status                          # confirm it shows as linked
md unlink                          # hand it back when done
```

`internal-portal` is linked **always**, backend-only rounds included: its
container is a static SPA baked with deployed config (since 2026-09-13, #157), so
its sign-in leaves the stack and the local email form never appears. Linking
changes where the **click** goes. Link the portal you are changing as well.

**Backend service → `md host`**

```bash
md host hoa --stack hao-local-debug   # container → socat stub, plus a `Stack` launch profile
md status                             # prints the assigned host port for the hosted service
dotnet run --project Apps/Hoa/Hoa.App --launch-profile Stack --urls http://0.0.0.0:<port>
ss -tlnp | grep :<port>               # must be *:<port>, never 127.0.0.1:<port>
md unhost hoa                         # when done
```

The port is the one `md` wrote into the `Stack` profile, not whatever
`launchSettings.json` had before — md allocates from the service's dev port
upward (5517 for Hoa) and records it, so read it back from `md status`.

The container becomes a socat stub pointing at `host.docker.internal`, so every
other service keeps calling `http://hoa:8080` and reaches your process. The one
hard requirement: the process binds `*:<port>`, because loopback kills every
in-stack S2S call and the failure surfaces in an unrelated place. `md status`
reports "listening" either way — only `ss -tln` distinguishes them. Symptoms, the
`ASPNETCORE_URLS` fallback and the rest: `references/md-deep-reference.md`.

### 3. VERIFY — host registration, then sign in

```bash
md add-website <company>   # <company>.with.hao-local-debug.md.test is not in /etc/hosts until this runs
```

Open `https://internal.hao-local-debug.md.test`. The page always shows "Sign In
with Google" — that is normal. **The check is the click:** it must land on the
stack's "Local stack sign-in" **email form** at
`auth.hao-local-debug.md.test/internal/local-login`; a jump to real
`accounts.google.com` means internal-portal is still containerized. Sign in as
**`hao-ruan@magicdoor.com`** — that row exists in the stack DB, while any other
address creates a brand-new full-permission employee and pollutes the stack. Then
pick the company and **Shadow Login** the user row. Shadow tokens expire in **1
minute**, so register the host first. Full role-session procedure:
`magicdoor-e2e`.

### 4. DOWN

```bash
md down --stack hao-local-debug
```

## Data and schema — reuse, migrate, rarely rebuild

- **Reuse is automatic.** Only databases that are new or empty are restored from
  staging; a database with tables is never touched.
- **Code ahead of the local schema → `md migrate --stack hao-local-debug`**, run
  from the checkout that carries the migration (it applies that checkout's EF
  projects). The normal path when master moves on, and the only one needed when
  your branch adds a migration.
- **Rebuild the data → `md reset --data --stack hao-local-debug`**: drops and
  re-restores every database. For rotted test rows or after a destructive
  migration.
- **Never substitute mock data for the staging restore.** The dump carries the
  `custom_domain` clearing that keeps generated URLs on this stack, the
  `hogwarts` company, and the employee row Shadow Login needs.
- **The one `md nuke` case:** a destructive migration (dropped or renamed
  columns, NOT NULL without a default) runs on a scratch stack, never on
  `hao-local-debug`.

## Images — no branch code will ever be there

Images are pinned by digest and re-checked at most once per 24 h, so a plain
`md up` does not talk to the registry. It is contacted only on `-r/--refresh`,
`--from <tag>` or `md reset --images`.

The registry holds **published** builds: `master`, `dev`, `staging`, and shas
that were deployed. A feature branch has none — `ci.yml` runs on `pull_request`
only and publishes nothing, while `service-release.yml` / `service-stage.yml`
push the `ci-<runid>-<attempt>` tag after merge. So `--from` is not how branch
code reaches the stack; `md host` is.

## Common Mistakes (observed in real incidents)

- **Building an image and swapping it in via `compose.override.yml`** — md only
  pulls registry images, and `md up` regenerates `compose.yml` without the
  override, so the swap silently reverts. Use `md host`.
- **`md up --only <just the service you need>`** — `--remove-orphans` tears the
  rest of the stack down, and for a branch change that service is a master image
  anyway. Always re-run with the full list plus the addition; with no `--only` at
  all you get all 23 services, `frauddetection` (1.4 GB) included.
- **`md` without `--stack hao-local-debug` from a worktree** — a branch-named
  stack appears and the next `md up` re-pulls 23 images and restores 14
  databases.
- **Hosting a backend service on loopback** — the process must listen on
  `*:<port>`; `127.0.0.1` kills every in-stack S2S call and disguises itself as
  an unrelated 502, 422 or a login that drops back to `/login`. Check
  `ss -tlnp | grep :<port>` first.
- **Signing in through the containerized internal portal** — the Google button is
  normal; link internal-portal instead of debugging the login.
- **Dev server fails on a package export error** → stale `node_modules`
  (`pnpm install --frozen-lockfile`), in the worktree.
- **Reaching for `vite build` + preview + faked environments**
  (`VITE_MD_STACK_DOMAIN`, hand-edited `/etc/hosts`) instead of the stack — a
  linked dev server already targets the stack and its localhost port is
  whitelisted.
- **Editing `~/.magicdoor/src`** (the managed CLI checkout, replaced on update)
  — clone and point `MD_CLI_SOURCE` at the clone.

## References

- `references/module-workflow.md` — the frontend round in detail (link,
  shadow-login walkthrough, module → backend services map).
- `references/md-deep-reference.md` — one-time setup, address map, full
  troubleshooting list, red flags.

## Related

| Skill | Role |
|---|---|
| `magicdoor-e2e` | Shadow Login details: company selection, tabs, pitfalls |
| `magicdoor-backend-swagger` | service URLs and swagger group lookup (`magicdoor-env`) |
