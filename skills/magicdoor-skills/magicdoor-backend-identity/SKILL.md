---
name: magicdoor-backend-identity
description: >
  MagicDoor backend identity reference. Lookup tables for Spec → user_type,
  high-privilege MagicDoor userIds (dev/test), and the debug token URL formula.
  Use when determining which user_type a spec requires, which userId to use,
  or diagnosing 401/403 auth mismatches. Does not execute requests or mint tokens.
---

# MagicDoor Backend Identity

Reference only. Does not execute requests. Token generation and API calls belong
in `magicdoor-backend-api`.

## Spec → user_type

| Spec Name | Required user_type |
|-----------|-------------------|
| `InternalApp` | `MagicDoor` |
| `Debug` | `MagicDoor` |
| `Service2Service` | `System` or `MagicDoor` |
| `CompanyApp` / `CompanyWeb` | `PropertyManager` |
| `TenantApp` | `Tenant` |
| `OwnerApp` | `Owner` |
| `VendorApp` | `Vendor` |
| `Homepage` | No auth |

Path-prefix fallback when spec is `Default` or unknown:

| Path prefix | user_type |
|-------------|-----------|
| `/internal-app/*` | `MagicDoor` |
| `/debug/*` | `MagicDoor` |
| `/service-2-service/*` | `System` or `MagicDoor` |
| `/company-app/*` / `/company-web/*` | `PropertyManager` |
| `/tenant-app/*` | `Tenant` |
| `/owner-app/*` | `Owner` |
| `/vendor-app/*` | `Vendor` |
| `/homepage/*` | No auth |

## MagicDoor userIds

| Environment | userId | Name |
|-------------|--------|------|
| dev | `1480743304903122944` | Lei Wang |
| test | `1476492890174410752` | Hao Ruan |

## Token

```bash
AUTH_URL=$(magicdoor-env -s auth -e "$env" -j | jq -r '.url')
curl -s "$AUTH_URL/debug/generate-token?userId=$id"
```

Ensure `magicdoor-env` is available via `magicdoor-backend-swagger` first.

## Rules

1. Never mix env userIds or tokens across environments
2. Omitting `userId` returns a `System` token — not valid for `MagicDoor` endpoints
3. Trust `iss` (not `aud`) to identify the environment
