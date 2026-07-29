#!/usr/bin/env bash
# Mint a MagicDoor shadow magic-link URL. Prints one URL to stdout; does not open a browser.
#
# URL sources (env CLI):
#   magicdoor-env -s auth|portal -e <env> -j   → API bases
#   magicdoor-env portals -e <env> -j          → frontend hosts + {subUrl} patterns
#
# Usage: mint-magic-link-url.sh <env> <portal> <userId> [companyId]
#   env:       test | dev
#   portal:    company | hoa | owner | tenant
#   companyId: required for owner|tenant (loads subUrl)
set -euo pipefail

ENV="${1:-}"
PORTAL="${2:-}"
USER_ID="${3:-}"
COMPANY_ID="${4:-}"

if [[ -z "$ENV" || -z "$PORTAL" || -z "$USER_ID" ]]; then
  echo "Usage: $0 <test|dev> <company|hoa|owner|tenant> <userId> [companyId]" >&2
  exit 2
fi
if [[ "$ENV" != "test" && "$ENV" != "dev" ]]; then
  echo "env must be test or dev (no staging/prod debug tokens)" >&2
  exit 2
fi
if [[ "$PORTAL" == "owner" || "$PORTAL" == "tenant" ]] && [[ -z "$COMPANY_ID" ]]; then
  echo "companyId required for owner|tenant" >&2
  exit 2
fi
if ! command -v magicdoor-env >/dev/null 2>&1; then
  echo "magicdoor-env not found — load magicdoor-backend-swagger first" >&2
  exit 1
fi

# From magicdoor-backend-identity unless overridden
if [[ -z "${MAGICDOOR_USER_ID:-}" ]]; then
  case "$ENV" in
    test) MAGICDOOR_USER_ID=1476492890174410752 ;;
    dev)  MAGICDOOR_USER_ID=1480743304903122944 ;;
  esac
fi

AUTH_URL=$(magicdoor-env -s auth -e "$ENV" -j | jq -r '.url')
PORTAL_API=$(magicdoor-env -s portal -e "$ENV" -j | jq -r '.url')
PORTALS_JSON=$(magicdoor-env portals -e "$ENV" -j)

MD_TOKEN=$(curl -sS "$AUTH_URL/debug/generate-token?userId=$MAGICDOOR_USER_ID" | jq -r '.access_token')
if [[ -z "$MD_TOKEN" || "$MD_TOKEN" == "null" ]]; then
  echo "failed to mint MagicDoor token" >&2
  exit 1
fi

IC=$(curl -sS -X POST "$AUTH_URL/login/$USER_ID/shadow" \
  -H "Authorization: Bearer $MD_TOKEN" | jq -r '.interactionCode')
if [[ -z "$IC" || "$IC" == "null" ]]; then
  echo "shadow failed (need MagicDoor + auth:shadow; IC TTL ~1m)" >&2
  exit 1
fi

# Frontend path shared by all portals (Internal UI shadow handoff).
magic_link() {
  echo "${1%/}/auth/magic-link?token=${IC}"
}

fill_suburl() {
  echo "${1//\{subUrl\}/$2}"
}

company_suburl() {
  local sub
  sub=$(curl -sS -H "Authorization: Bearer $MD_TOKEN" \
    "$PORTAL_API/internal-app/companies/$COMPANY_ID" | jq -r '.subUrl // empty')
  if [[ -z "$sub" ]]; then
    echo "company $COMPANY_ID missing subUrl" >&2
    exit 1
  fi
  echo "$sub"
}

case "$PORTAL" in
  company)
    magic_link "$(echo "$PORTALS_JSON" | jq -r '.portals.pmPortal')"
    ;;
  hoa)
    magic_link "$(echo "$PORTALS_JSON" | jq -r '.portals.hoaPortal')"
    ;;
  owner)
    magic_link "$(fill_suburl "$(echo "$PORTALS_JSON" | jq -r '.clientPortals.ownerPortal')" "$(company_suburl)")"
    ;;
  tenant)
    magic_link "$(fill_suburl "$(echo "$PORTALS_JSON" | jq -r '.clientPortals.tenantPortal')" "$(company_suburl)")"
    ;;
  *)
    echo "portal must be company|hoa|owner|tenant" >&2
    exit 2
    ;;
esac
