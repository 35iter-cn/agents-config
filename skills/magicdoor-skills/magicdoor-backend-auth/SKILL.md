---
name: magicdoor-backend-auth
description: >
  MagicDoor backend authentication reference. Covers debug token generation,
  user roles and their accessible resources, high-privilege userIds for dev/test
  environments, and how to obtain tokens for different user_types via the
  /debug/generate-token endpoint. Use when the user or a calling skill needs
  to authenticate against MagicDoor backend APIs, determine which user_type
  is required for a given spec, or resolve 401/403 auth failures.
---

# MagicDoor Backend Auth

## User Roles & Resource Access

| user_type | Can Access | Typical Use |
|-----------|-----------|-------------|
| `MagicDoor` | Internal, Debug, Service2Service specs | Internal portal, admin operations |
| `System` | Service2Service spec | Inter-service calls |
| `PropertyManager` | CompanyApp, CompanyWeb specs | Company portal |
| `Tenant` | TenantApp spec | Tenant-facing features |
| `Owner` | OwnerApp spec | Owner-facing features |
| `Vendor` | VendorApp spec | Vendor-facing features |
| (none) | Homepage spec | Public pages |

### Spec → Required user_type

| Spec Name | Required user_type |
|-----------|-------------------|
| `Internal` | `MagicDoor` |
| `Debug` | `MagicDoor` |
| `Service2Service` | `System` or `MagicDoor` |
| `CompanyApp` / `CompanyWeb` | `PropertyManager` |
| `TenantApp` | `Tenant` |
| `OwnerApp` | `Owner` |
| `VendorApp` | `Vendor` |
| `Homepage` | No auth |

## Debug Token Generation

### Endpoint
```
GET https://auth.magicdoor-{env}.com/debug/generate-token?userId={userId}
```

### High-Privilege UserIds (MagicDoor role)

| Environment | userId | Name |
|-------------|--------|------|
| dev | `1480743304903122944` | Lei Wang |
| test | `1476492890174410752` | Hao Ruan |

### Token Response
```json
{
  "access_token": "eyJhbG...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### Validate Token (check claims)
```bash
python3 -c "
import base64, json
payload = 'TOKEN'.split('.')[1]
padding = 4 - len(payload) % 4
if padding != 4: payload += '=' * padding
data = json.loads(base64.urlsafe_b64decode(payload))
print(json.dumps({k: data.get(k) for k in ['sub', 'user_type', 'aud', 'permissions', 'iss']}, indent=2))
"
```

Key claims to verify:
- `user_type` matches the spec requirement
- `iss` matches the target environment's auth domain
- `permissions` covers required scope (usually `*` for debug tokens)

## Obtaining Other Role Tokens

If you need a non-MagicDoor token (e.g., `PropertyManager`):

1. Use a MagicDoor token to call the users/search endpoint
2. Find the target user's `userId`
3. Call `/debug/generate-token?userId={userId}` with that user's ID

The token returned will have that user's `user_type` in its claims.

## Common Mistakes

- **❌ Dev/test userIds are NOT interchangeable**
  - Dev userId `1480743304903122944` → `User not found` on test auth
  - Test userId `1476492890174410752` → `User not found` on dev auth
  - Always use the userId matching the target environment

- **❌ Dev/test tokens are NOT interchangeable**
  - Dev token (issuer: `auth.magicdoor.dev`) → 401 on test services
  - Test token (issuer: `auth.magicdoor-test.com`) → 401 on dev services
  - Each environment validates tokens against its own auth service

- **❌ Omitting `userId` parameter**
  - `GET /debug/generate-token` without `userId` returns a `System` role token
  - `Internal` and `Debug` specs require `MagicDoor` role → will 401
  - Always provide the `userId` parameter for MagicDoor tokens

- **❌ Wrong `audience` assumption**
  - Both dev and test tokens have `aud: ["magicdoor.com"]` — this is the API audience, not the auth domain
  - The issuer (`iss`) is what distinguishes the environment
