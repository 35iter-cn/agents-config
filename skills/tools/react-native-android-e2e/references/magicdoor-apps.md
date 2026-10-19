# MagicDoor React Native apps on the emulator

Two apps share this shape: **magic-resident** (tenant, `MagicDoorInc/magic-resident`) and **magic-manager**
(property manager, `MagicDoorInc/magic-manager`). Both are Expo development builds with an `android/` project,
an `env.json` per environment, and an npm lockfile.

| | magic-resident | magic-manager |
| --- | --- | --- |
| Bundle id | `com.magicdoor.magicresident` | `com.magicdoor.magicmanager` |
| Dev API base | `https://app-dev.magicdoor.io/tenant` | `https://app-dev.magicdoor.io/company` |
| Other dev hosts | `auth-dev.magicdoor.io`, `files.magicdoor.dev`, `pay.magicdoor.dev`, `services.magicdoor.dev` | `auth-dev.magicdoor.io` |
| Extra env keys | `payBaseUrl`, `stripePublishableKey`, `maintenanceBaseUrl`, `filesServiceBase` | none |
| Windows build doc | `docs/windows-android.md` | same pattern, no doc |

AVD used for both: `expo-device` (API 35, google_apis, x86_64). One emulator hosts both apps; the dev launcher
distinguishes them by the server entry.

# Getting a tenant session in dev

magic-resident only. The app has no bypass: it signs in with `email + password` against `{apiBaseUrl}/auth/password`. So a test
tenant needs a known password, set from the property-manager side.

## 1. Pick a tenant that can reach the screen (magic-resident)

The app's pay surface is gated by the company feature flag, read at login as
`user.companyInfo.features.includes('centralizedPayments')` (`src/use-cases/payment/initializePaymentModeUseCase.ts`).
Without it the app is in legacy mode: payment methods come from `API_BASE_URL/payment-accounts` and adding
one opens Stripe embedded checkout — the `${payBaseUrl}/tenant-portal/*` endpoints are never called, so
nothing that depends on them can be verified there.

Dev companies known at 2026-10-19: `GK Properities` (`1484005166355513344`) has the flag;
`Hogwarts Estates & Properties1` (`1192372134522703872`) does not. Tenants and leases per company come from
the dev `magicdoor` Postgres (`tenants`, `leases`, `leases_tenants`; credentials in
`~/.config/magicdoor/db-credentials.md`). Prefer `*@magicdoor-demo.com` demo tenants over colleagues' addresses.

## 2. Obtain a property-manager token

1. Shared Chrome (CDP 9222) → `https://internal.magicdoor.dev/` logged in as Hao. The employee token is
   `JSON.parse(localStorage['MagicAuth:internal_portal:acct:<id>:0']).access_token`.
2. PM list: `GET https://internal.magicdoor.dev/api/internal/companies/{companyId}/property-managers?pageSize=5`
   with `Authorization: Bearer <employeeToken>` (same-origin call from the internal portal page works).
3. Shadow login: `POST https://auth.magicdoor.dev/login/{pmUserId}/shadow` with the same bearer → JSON
   `{ interactionCode }`. The code expires in about five minutes.
4. Open `https://portal.magicdoor.dev/auth/magic-link?token={interactionCode}` in a tab. After the redirect,
   the PM token is `JSON.parse(localStorage['MagicAuth:company_portal:acct:{pmUserId}:{companyId}']).access_token`.
   Do steps 3–4 back to back; a stale code fails as an HTTP error page.

## 3. Set the tenant password

```bash
curl -X POST "https://api.portal.magicdoor.dev/company-app/tenants/{tenantId}/password" \
  -H "Authorization: Bearer <pmToken>" -H "Content-Type: application/json" \
  -d '{"password":"MagicDoor2026"}'
```

200 returns the hydrated tenant. Then sign in in the app with the tenant email and that password. Prefer a
password without `!`/`&`/`$` — `adb shell input text` does not decode them and they land literally.

Dev data is shared: write down which tenant you changed, and do not touch invoices, bills, payment methods
or company flags to get a session.
