---
name: magicdoor-portal-ui-login
description: >
  Mints a MagicDoor shadow magic-link URL for company/HOA, owner, or tenant
  portal sign-in. Use when the agent needs a non-destructive portal login URL
  for UI testing, E2E, or screenshots. Not for API-only auth (use
  magicdoor-backend-api + debug token) and not for driving the browser.
---

# MagicDoor Portal UI Login

**MagicDoor token → `POST /login/{userId}/shadow` → magic-link URL.** Return the URL; do not open it.

Hosts and client URL patterns come from **`magicdoor-env portals`**, not hardcoded domains.

## Quick start

```bash
./scripts/mint-magic-link-url.sh test hoa 1531544776654970880
./scripts/mint-magic-link-url.sh test company 1531544776654970880
./scripts/mint-magic-link-url.sh test owner 1531552188509036544 1531544776063574016
./scripts/mint-magic-link-url.sh test tenant 1531551749789032448 1531544776063574016
```

Preview: `test | shadow magic-link | hoa PM {userId}`

## Prerequisites

1. `magicdoor-backend-swagger` — `magicdoor-env` (run `-h` once per session)
2. `magicdoor-backend-identity` — MagicDoor userIds (`MAGICDOOR_USER_ID` overrides)
3. Env **test** or **dev** only

## Workflow

1. Resolve `userId` and, for owner/tenant, `companyId` (needs `subUrl`).
2. `./scripts/mint-magic-link-url.sh <env> <company|hoa|owner|tenant> <userId> [companyId]`
3. Return the printed URL (`chrome-debug` or human opens it).

### What the script reads from env CLI

| Source | Used for |
|--------|----------|
| `magicdoor-env -s auth -e … -j` | Auth API base (debug token + shadow) |
| `magicdoor-env -s portal -e … -j` | Portal API base (`/internal-app/companies/{id}` → `subUrl`) |
| `magicdoor-env portals -e … -j` | `portals.pmPortal` / `hoaPortal`; `clientPortals.ownerPortal` / `tenantPortal` (`{subUrl}` filled) |

Magic-link suffix `/auth/magic-link?token=` is the shared frontend handoff path (Internal UI). Do not use Auth `/shadow/{id}/token` (API bearer).

## Anti-patterns

- Hardcoding `*.magicdoor-*.com` hosts — use `magicdoor-env portals`
- `generate-password` — overwrites hash
- Auth S2S OTP in UI OTP box — 403
- System token (no userId) for shadow — 403
- Holding IC without handing off URL — ~1 min TTL

## Related

| Skill | Role |
|-------|------|
| `magicdoor-backend-identity` | MagicDoor userIds |
| `magicdoor-backend-api` | API debug tokens |
| `chrome-debug` | Optional: open the returned URL |
