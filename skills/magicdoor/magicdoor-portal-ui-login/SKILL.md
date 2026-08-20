---
name: magicdoor-portal-ui-login
description: >
  Mints a MagicDoor shadow magic-link token and constructs the correct portal
  sign-in URL for company/HOA, owner, or tenant portals. Use when the agent
  needs a portal login URL for UI testing, E2E, or screenshots. Not for
  API-only auth (use magicdoor-backend-api + debug token).
---

# MagicDoor Portal UI Login

**MagicDoor token → `POST /login/{userId}/shadow` → token → construct URL.**

Token TTL is ~1 minute. Construct and navigate to the URL immediately after minting — no intermediate steps.

## Path resolution

Command paths (e.g. `scripts/mint-magic-link-url.sh`) are relative to this skill's directory, not the shell cwd. Resolve the script's absolute path before running.

## Quick start

```bash
scripts/mint-magic-link-url.sh test hoa 1531544776654970880
scripts/mint-magic-link-url.sh test company 1531544776654970880
scripts/mint-magic-link-url.sh test owner 1531552188509036544 1531544776063574016
scripts/mint-magic-link-url.sh test tenant 1531551749789032448 1531544776063574016
```

The script prints a URL. Extract the `token=` query param and construct the final URL using the tables below.

## Prerequisites

1. `magicdoor-backend-swagger` — `magicdoor-env` (run `-h` once per session)
2. `magicdoor-backend-identity` — MagicDoor userIds (`MAGICDOOR_USER_ID` overrides)
3. Env **test** or **dev** only

## Workflow

1. Resolve `userId` and, for owner/tenant, `companyId` (needs `subUrl`).
2. Run `scripts/mint-magic-link-url.sh <env> <company|hoa|owner|tenant> <userId> [companyId]`
3. Extract the `token` value from the printed URL.
4. Determine the target host (see **Host resolution** below).
5. Construct the full URL using the **Magic-link paths** table.
6. Navigate immediately — token expires in ~1 min.

## Host resolution

Never hardcode domains. Always derive from `magicdoor-env`:

```bash
magicdoor-env portals -e <env> -j
```

Output shape:
```json
{
  "portals": {
    "pmPortal": "https://portal.magicdoor-test.com",
    "hoaPortal": "https://hoa.magicdoor-test.com"
  },
  "clientPortals": {
    "ownerPortal": "https://{subUrl}.with.magicdoor-test.com/owners",
    "tenantPortal": "https://{subUrl}.with.magicdoor-test.com/tenants"
  }
}
```

Replace `{subUrl}` with the company's `subUrl` (from `/internal-app/companies/{id}`).

**Local dev:** host is `http://localhost:{port}` where port is determined by the currently running dev server (infer from context). `subUrl` is not part of the host — it is injected via `VITE_DEV_COMPANY_HOST` at server startup.

## Magic-link paths

| Portal | Full path |
|--------|-----------|
| Owner Portal | `{ownerPortalHost}/auth/magic-link?token={token}` |
| Tenant Portal | `{tenantPortalHost}/auth/magic-link?token={token}` |
| Company / HOA PM Portal | `{pmPortal or hoaPortal}/auth/magic-link?token={token}` |

Where `ownerPortalHost` = `clientPortals.ownerPortal` with `{subUrl}` filled in (strip trailing path if constructing manually), e.g. `https://rossellhoa.with.magicdoor-test.com/owners`.

For local dev, prepend `http://localhost:{port}` and keep the path segment:

| Portal | Local path |
|--------|-----------|
| Owner Portal | `http://localhost:{port}/owners/auth/magic-link?token={token}` |
| Tenant Portal | `http://localhost:{port}/tenants/auth/magic-link?token={token}` |
| Company / HOA PM Portal | `http://localhost:{port}/auth/magic-link?token={token}` |

## Portal identity requirements

| Portal | Required account identity |
|--------|---------------------------|
| Company / HOA | `PropertyManager` |
| Owner | `Owner` |
| Tenant | `Tenant` |

Each portal only works with a business account of the matching identity. System accounts (`user_type=MagicDoor` — see `magicdoor-backend-identity`) are fine for minting tokens, but signing a portal in with one yields a `MagicDoor` session the backend rejects on business endpoints (403). Use the Quick start example accounts for smoke tests, or business accounts of the matching type.

## What the script reads from env CLI

| Source | Used for |
|--------|----------|
| `magicdoor-env -s auth -e … -j` | Auth API base (debug token + shadow) |
| `magicdoor-env -s portal -e … -j` | Portal API base (`/internal-app/companies/{id}` → `subUrl`) |
| `magicdoor-env portals -e … -j` | Host templates for all portals |

## Anti-patterns

- Hardcoding `*.magicdoor-*.com` hosts — use `magicdoor-env portals`
- Navigating to the line-output URL directly for local dev — extract token, reconstruct with `localhost:{port}`
- Any delay between minting and navigating — token TTL ~1 min
- `generate-password` — overwrites hash
- Auth S2S OTP in UI OTP box — 403
- System token (no userId) for shadow — 403

## Related

| Skill | Role |
|-------|------|
| `magicdoor-backend-identity` | MagicDoor userIds |
| `magicdoor-backend-api` | API debug tokens |
| `chrome-debug` | Open the constructed URL |
