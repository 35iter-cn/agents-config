# Case: Create Test Company

## Trigger Phrases

- "弄个 test 环境的公司"
- "帮我创建一个 test company"
- "create a test company"
- "在 test 环境创建公司"

## Matched Intent

- **Action**: create
- **Target**: company
- **Environment**: test (default)

## Flow Steps

### Step 1: Environment Inference

```
Environment: test (default when not specified)
```

### Step 2: Auth Token

- **Spec**: InternalApp → **user_type**: MagicDoor
- **Endpoint**: `GET https://auth.magicdoor-test.com/debug/generate-token?userId=1476492890174410752`
- **User**: Hao Ruan (MagicDoor internal)
- **Token Claims**:
  ```json
  {
    "iss": "auth.magicdoor-test.com",
    "user_type": "MagicDoor",
    "permissions": "*",
    "name": "Hao Ruan"
  }
  ```

### Step 3: Endpoint Discovery

- **Service**: `portal`
- **Spec**: `InternalApp`
- **Cache**: `npm exec -- @magicdoorinc/env cache query --service portal --env test --spec-name InternalApp`
- **Endpoint**: `POST /internal-app/companies` (operationId: `CreateCompany`)

### Step 4: Request Schema

**InternalCreateCompanyDto** (required fields):

| Field | Type | Constraints |
|-------|------|-------------|
| `companyName` | string | 3-250 chars |
| `language` | string (enum) | 2 chars, ISO language code (e.g. `"en"`) |
| `timeZone` | string (timezone) | Valid IANA timezone (e.g. `"America/Los_Angeles"`) |
| `subscription` | enum | `"free"`, `"advanced"`, `"professional"` |
| `selfManaged` | boolean | |
| `propertyManagerEmail` | string (email) | Valid email pattern |
| `propertyManagerFirstName` | string | 2-250 chars |
| `propertyManagerLastName` | string | 2-250 chars |
| `address` | RequiredAddressDto | see below |
| `defaultPortfolioName` | string (optional) | 3-250 chars |
| `propertyManagerPhoneNumber` | string (optional) | 10-13 chars |
| `propertyManagerPassword` | string (optional) | 3-250 chars, auto-generated if omitted |
| `trialAccountUntil` | date (optional) | |
| `estimatedGoLiveDate` | date (optional) | |

**RequiredAddressDto**:

| Field | Type | Constraints |
|-------|------|-------------|
| `streetAddress1` | string | 1-250 chars (required) |
| `streetAddress2` | string | 1-150 chars (optional) |
| `city` | string | 2-150 chars |
| `state` | string | 2-25 chars |
| `zipCode` | string | 2-25 chars |
| `country` | string | 3-25 chars (optional) |

### Step 5: Example Request Body

```json
{
  "companyName": "Test Company",
  "language": "en",
  "timeZone": "America/Los_Angeles",
  "subscription": "free",
  "selfManaged": false,
  "propertyManagerEmail": "pm-test@magicdoor.com",
  "propertyManagerFirstName": "Test",
  "propertyManagerLastName": "PM",
  "address": {
    "streetAddress1": "123 Test St",
    "city": "Los Angeles",
    "state": "CA",
    "zipCode": "90001"
  }
}
```

### Step 6: Execution

```bash
curl -s -w "\nHTTP %{http_code}\n" \
  -X POST "https://api.portal.magicdoor-test.com/internal-app/companies" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

### Step 7: Response Schema

**InternalCreateCompanyResultDto**:

```json
{
  "companyId": "1513797875019673600",
  "propertyManagerId": "1513797875233583104",
  "propertyManagerEmail": "pm-test@magicdoor.com",
  "propertyManagerPassword": "6bfp6j",
  "defaultPortfolioId": "1513797875657207808",
  "bankAccountId": "1513797875956436992"
}
```

## Parameter Variations

| Scenario | companyName | subscription | selfManaged |
|----------|-------------|--------------|-------------|
| Free basic | `"Test Company"` | `"free"` | `false` |
| Professional self-managed | `"Test Co Pro"` | `"professional"` | `true` |
| Advanced company | `"Test Co Advanced"` | `"advanced"` | `false` |
