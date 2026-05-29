# Create Company

<objective>
Create a company in `dev` or `test` and return the default Property Manager credentials.
</objective>

<execution_context>
Use `@magicdoor/env -e <env> -s auth -j` to resolve the auth base URL and `@magicdoor/env -e <env> -s portal -j` to resolve the portal service base URL.

Use `@./../shared/internal-auth.md` for transparent System-level authentication.
</execution_context>

<context>
Input:
- `--case create-company`
- optional `--env <env>` where supported values are `dev` and `test`

Default `env` to `test` when it is not provided.

This case creates the company only. Do not complete onboarding or any follow-up setup.
</context>

<process>
### Step 1 - Validate Environment

Validate `env` before doing anything else:

- `dev` or `test`: continue
- any other value: stop immediately and tell the user the case supports only `dev` and `test`

### Step 2 - Resolve Service URLs

Resolve the auth service base URL:

```bash
npm exec -- @magicdoor/env -e <env> -s auth -j
```

Resolve the portal service base URL:

```bash
npm exec -- @magicdoor/env -e <env> -s portal -j
```

Parse each returned `url` field.

### Step 3 - Acquire a System Token

Follow `@./../shared/internal-auth.md` and acquire a System token without asking the user for auth material.

Prefer the System debug token method for this case.

### Step 4 - Create the Company

Call the debug company creation endpoint:

```bash
curl -s -X POST "${PORTAL_BASE_URL}/debug/companies" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "companyName": "Case Mode Test Company",
    "language": "en",
    "timeZone": "Pacific Standard Time",
    "selfManaged": false,
    "subscription": "free",
    "propertyManagerEmail": "pm.case-mode-test@example.com",
    "propertyManagerFirstName": "Case",
    "propertyManagerLastName": "Manager",
    "propertyManagerPassword": "CaseTest123!",
    "address": {
      "streetAddress1": "100 Case Mode Street",
      "city": "San Francisco",
      "state": "CA",
      "zipCode": "94105",
      "country": "USA"
    }
  }'
```

Extract these fields from the response:
- company name
- company id
- public portal URL when available
- default Property Manager email
- default Property Manager password

### Step 5 - Output Concise Summary Only

Return only a concise summary in this format:

```text
Company: <name>
Company ID: <company-id>
Portal: <public-url>
PM Email: <email>
PM Password: <password>
```

### Step 6 - Handle Errors

- `400`: show the validation errors and stop
- `401` or `403`: report authentication failure and stop
- any other non-200 response: show the HTTP status and error body, then stop
</process>

<critical_rules>
- Default `env` to `test`
- Support only `dev` and `test`
- Never ask the user for `token` or `refresh_token`
- Do not complete onboarding after company creation
- Output concise summary only
</critical_rules>

<success_criteria>
- The company is created through `POST /debug/companies`
- The response summary includes the PM credentials
- The case stops immediately on unsupported environments or auth failure
</success_criteria>
