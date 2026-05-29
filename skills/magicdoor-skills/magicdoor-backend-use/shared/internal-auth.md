# Internal Auth

<objective>
Explain how cases can acquire System-level tokens for internal APIs without asking the user for token material.
</objective>

<context>
This reference applies only to `dev` and `test`.

For any other environment, stop immediately and ask the user to switch environments.

Token acquisition must stay transparent to the user. Never ask for `token`, `refresh_token`, or any manual auth handoff.
</context>

<process>
### Method 1 - System Debug Token

1. Resolve the auth service base URL:

```bash
npm exec -- @magicdoor/env -e <env> -s auth -j
```

2. Parse the returned `url` field as `AUTH_BASE_URL`.
3. Call the debug token endpoint without `userId`:

```bash
curl -s "${AUTH_BASE_URL}/debug/generate-token"
```

4. Parse the bearer token from the response.

Expected properties:
- `user_type: System`
- wildcard internal permissions
- `expires_in: 3600`

Use this method for internal-app and debug endpoints.

### Method 2 - Client Credentials

1. Resolve the auth service base URL:

```bash
npm exec -- @magicdoor/env -e <env> -s auth -j
```

2. Parse the returned `url` field as `AUTH_BASE_URL`.
3. Request an access token with the backend client:

```bash
curl -s -X POST "${AUTH_BASE_URL}/oauth/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "grant_type=client_credentials&client_id=portal-backend&client_secret=<client-secret>"
```

4. Parse the bearer token from the response.

Expected properties:
- `user_type: System`
- `expires_in: 900`

Use this method for service-to-service calls when the debug endpoint is not the right fit.
</process>

<critical_rules>
- Support only `dev` and `test`
- Keep token acquisition transparent to the user
- Prefer the System debug token for debug and internal operational cases
- Fall back to client credentials only when that better matches the target endpoint
</critical_rules>
