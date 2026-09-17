---
name: magicdoor-e2e
description: >
  Sign in to any MagicDoor portal through the Internal Portal and shadow-log in as a
  test user of any role (property manager, tenant, owner, vendor). Use for end-to-end
  testing, UI walkthroughs, screenshots, or any task that needs a real browser session
  in a client portal. Covers local stacks (md) and the test environment.
---

# MagicDoor E2E: one entry point, every role

**One path, always the same:** sign in to the Internal Portal as Hao → open the company →
find the user row → `Shadow Login`. That hands the browser a real session in the target
portal as that user. No token minting, no URL assembly, no userId lookups.

## When to use

- E2E/UAT that must exercise the real UI (clicking through, screenshots, verifying what a
  PM/tenant/owner/vendor actually sees).
- Any task needing a browser session in `portal.` / `hoa.` / `{subUrl}.with.` portals.

Not for API-only calls — see `magicdoor-backend-api` (debug tokens, no browser).

## Prerequisites

- `shared-chrome` — the shared Chrome with CDP on `127.0.0.1:9222`. Reuse its tabs and
  login state; do not launch a second browser instance.
- Environment determined: **local stack** (branch worktree + `md up`) or **test**
  (`https://internal.magicdoor-test.com`).

## Procedure

### 1. Open the Internal Portal and sign in as Hao

| Environment | URL | Sign-in |
|---|---|---|
| Local stack | `https://internal.<stack>.md.test/` | Click **Sign In with Google** → lands on a **"Local stack sign-in"** email form → enter **`hao-ruan@magicdoor.com`** |
| test / dev / demo | `https://internal.magicdoor-test.com/` | Click **Sign In with Google** → real Google OAuth → pick Hao's account |

On a local stack the email form replaces Google, because Google rejects `.test` redirect
URIs. **Use `hao-ruan@magicdoor.com`** — that address already exists in the stack's
database, so it signs in as the real employee with `permissions: *`. Any *other* address
creates a brand-new employee with full permissions, which pollutes the stack.

Reaching the Companies list means the whole chain worked (OAuth → token → jwks → API).

### 2. Open the company and pick the user's tab

Companies list → click the company. Tabs at the bottom of the company page:

| Tab | Shadow Login gets you |
|---|---|
| Property Managers | the PM/company portal (`portal.<domain>`, or `hoa.<domain>` for HOA companies) |
| Tenants | the tenant portal (`{subUrl}.with.<domain>/tenants`) |
| Owners | the owner portal (`{subUrl}.with.<domain>/owners`) |
| Vendors | the vendor portal (`{subUrl}.with.<domain>/vendors`) |

### 3. Click `Shadow Login` on the row

The row's action menu holds **`Shadow Login`**. Clicking it mints a shadow session and
opens the target portal in a **new tab**, already signed in as that user.

**HOA companies hop hosts automatically.** The shadow URL is always `portal.<domain>`, and
the company portal hands the session off to `hoa.<domain>` on login when the company's
`businessMode` is `Hoa` (`redirectToBusinessModeHostOnLogin`). So no HOA-specific step —
but if a company's mode has never been loaded, expect to land on `portal.` first.

### 4. Verify you are the right user

Check the portal's account menu / page content. The target portal shows that user's data,
not Hao's. Screenshots and further interaction continue in that tab.

## Finding the right user

- **Search** the tab's server-side search box (name / email / phone). It matches
  `meta_data_search` on the backend, which includes first/last name, email, phone, and the
  single-line address — **and the tax id (SSN/EIN)**, so an SSN search works too.
- The list shows Name / Email / Phone / Portal Status / Last Portal Invite / Created At.
  `Portal Status` tells you whether that user can actually sign in.

## Pitfalls

- **A user with no account cannot shadow-log in.** No row, or an inactive one, means no
  session to hand out. Create/invite first, or pick another user.
- **`Owner` and `Vendor` shadow login need the Internal Portal's Owners/Vendors tabs.**
  On `master` only **Property Managers** and **Tenants** exist; Owners/Vendors ship with
  `feat/internal-owners-vendors-tabs`. On test/older builds, pick a PM or tenant user, or
  run the branch on a local stack.
- **A row's shadow session is a fresh OAuth login on the target host** — the target portal's
  token store is separate from the internal portal's, so the new tab starts clean.
- **Do not test with a system token** (`user_type=MagicDoor`) against a business portal:
  the backend rejects it with 403. The shadow flow is role-correct by construction, which is
  exactly why it beats hand-minted tokens.
- **Local stack: a broken login is usually an addressing problem, not auth.** If the browser
  loads but sign-in fails, or the API 500s/401s, check the stack before the app — see the
  `magicdoor-local-stack` skill and the `md-cli-stack` knowledge set (proxy network
  attachment, FQDN resolution, HTTPS trust chain).

## Reference: what shadow login actually calls

`POST {auth}/login/{userId}/shadow` with the employee's token → returns an
`interactionCode` → the browser goes to `{portalUrl}/auth/magic-link?token=…`. Nothing on
the client assembles a userId or a host by hand; the Internal Portal reads the company's
`publicUrl` and the role's path segment from the API.

## Related

| Skill | Role |
|---|---|
| `shared-chrome` | the CDP browser used for every step |
| `magicdoor-local-stack` | `md up` / `md host` / `md link`; how the local stack is addressed |
| `magicdoor-backend-api` | API-only calls (debug token, no browser) |
| `magicdoor-backend-swagger` | swagger specs, `magicdoor-env` CLI |
