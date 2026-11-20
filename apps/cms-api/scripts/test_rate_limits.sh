#!/usr/bin/env bash
# test_rate_limits.sh — manual smoke-test for Rack::Attack throttle rules
#
# Usage:
#   ./test_rate_limits.sh [BASE_URL]
#
# Defaults to http://localhost:3000. Requires curl and jq.
#
# Before running, set a valid user email/password and hub invite code:
#   USER_EMAIL=... USER_PASSWORD=... INVITE_CODE=... ./test_rate_limits.sh

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
USER_EMAIL="${USER_EMAIL:-user@example.org}"
USER_PASSWORD="${USER_PASSWORD:-xyz123@@}"
INVITE_CODE="${INVITE_CODE:-BTRCYR}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

pass() { echo -e "${GREEN}  PASS${RESET} $*"; }
fail() { echo -e "${RED}  FAIL${RESET} $*"; }
info() { echo -e "${CYAN}  INFO${RESET} $*"; }
section() { echo -e "\n${YELLOW}=== $* ===${RESET}"; }

# Perform a request and return the HTTP status code
status() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

# ────────────────────────────────────────────────────────────
section "1. Login email throttle (10 per 10 min per email address)"

LOGIN_EMAIL="nobody@example.com"
info "Sending 10 failed login attempts with the same email..."
for i in $(seq 1 10); do
  code=$(status -X POST "$BASE_URL/api/login" \
    -H "Content-Type: application/json" \
    -d "{\"user\":{\"email\":\"$LOGIN_EMAIL\",\"password\":\"wrong\"}}")
  echo "  Attempt $i → HTTP $code"
done

info "11th attempt with the same email should be throttled (429)..."
code=$(status -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"user\":{\"email\":\"$LOGIN_EMAIL\",\"password\":\"wrong\"}}")
echo "  Attempt 11 → HTTP $code"
[[ "$code" == "429" ]] && pass "Email throttle fires at attempt 11 for non-existing email (existing accounts get 429 from lockable at attempt 10)" \
                        || fail "Expected 429, got $code"

info "Same IP, different email should still pass..."
code=$(status -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"different@example.com","password":"wrong"}}')
echo "  Different email → HTTP $code"
[[ "$code" != "429" ]] && pass "Different email is not throttled (per-address quota)" \
                         || fail "Expected non-429, got $code"

# ────────────────────────────────────────────────────────────
section "1b. Login IP throttle (5 per 15 min per IP)"

info "Testing IP throttle with distinct emails to avoid triggering the per-email throttle..."
for i in $(seq 1 5); do
  code=$(status -X POST "$BASE_URL/api/login" \
    -H "Content-Type: application/json" \
    -d "{\"user\":{\"email\":\"ip_test_${i}@example.com\",\"password\":\"wrong\"}}")
  echo "  Attempt $i → HTTP $code"
done

info "6th attempt (new email, same IP) should be throttled by IP (429)..."
code=$(status -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"ip_test_6@example.com","password":"wrong"}}')
echo "  Attempt 6 → HTTP $code"
[[ "$code" == "429" ]] && pass "IP throttle fires at attempt 6" \
                        || fail "Expected 429, got $code"

# ────────────────────────────────────────────────────────────
section "2. Password reset (5 per hour per IP)"

info "Sending 5 password reset requests..."
for i in $(seq 1 5); do
  code=$(status -X POST "$BASE_URL/api/password" \
    -H "Content-Type: application/json" \
    -d '{"user":{"email":"nobody@example.com"}}')
  echo "  Attempt $i → HTTP $code"
done

info "6th attempt should be throttled (429)..."
code=$(status -X POST "$BASE_URL/api/password" \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"nobody@example.com"}}')
echo "  Attempt 6 → HTTP $code"
[[ "$code" == "429" ]] && pass "Password reset throttle fires at attempt 6" \
                        || fail "Expected 429, got $code"

# ────────────────────────────────────────────────────────────
section "3. Signup (20 per 5 min per IP)"

info "Sending 20 signup requests..."
for i in $(seq 1 20); do
  code=$(status -X POST "$BASE_URL/api/signup" \
    -H "Content-Type: application/json" \
    -d "{\"user\":{\"email\":\"smoke_${i}@example.com\",\"password\":\"Test1234!\",\"password_confirmation\":\"Test1234!\",\"invite_code\":\"$INVITE_CODE\"}}")
  echo "  Attempt $i → HTTP $code"
done

info "21st attempt should be throttled (429)..."
code=$(status -X POST "$BASE_URL/api/signup" \
  -H "Content-Type: application/json" \
  -d "{\"user\":{\"email\":\"smoke_21@example.com\",\"password\":\"Test1234!\",\"password_confirmation\":\"Test1234!\",\"invite_code\":\"$INVITE_CODE\"}}")
echo "  Attempt 21 → HTTP $code"
[[ "$code" == "429" ]] && pass "Signup throttle fires at attempt 21" \
                        || fail "Expected 429, got $code"

# ────────────────────────────────────────────────────────────
section "4. Obtaining a JWT token for authenticated tests"

info "Logging in as $USER_EMAIL..."
login_response=$(curl -s -i -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"user\":{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASSWORD\"}}")

TOKEN=$(echo "$login_response" | grep -i '^authorization:' | awk '{print $2}' | tr -d '\r')

if [[ -z "$TOKEN" ]]; then
  fail "Could not obtain JWT — check USER_EMAIL / USER_PASSWORD / login throttle state"
  echo "  Response headers:"
  echo "$login_response" | head -20
  exit 1
fi
pass "Got JWT token (${TOKEN:0:40}...)"

# ────────────────────────────────────────────────────────────
section "5. Authenticated API throttle (300 per min per token)"

info "This test pre-fills the counter via curl — it will make 61 requests."
info "Sending 300 authenticated requests to saturate the counter..."

for i in $(seq 1 300); do
  curl -s -o /dev/null "$BASE_URL/api/about" \
    -H "Authorization: $TOKEN"
done

info "301st request should be throttled (429)..."
code=$(status "$BASE_URL/api/about" -H "Authorization: $TOKEN")
echo "  Request 301 → HTTP $code"
[[ "$code" == "429" ]] && pass "Authenticated API throttle fires at request 301" \
                        || fail "Expected 429, got $code"

# ────────────────────────────────────────────────────────────
section "6. Unauthenticated API throttle (60 per min per IP)"

info "Sending 60 unauthenticated requests..."
for i in $(seq 1 60); do
  curl -s -o /dev/null "$BASE_URL/api/about"
done

info "61st request should be throttled (429)..."
code=$(status "$BASE_URL/api/about")
echo "  Request 61 → HTTP $code"
[[ "$code" == "429" ]] && pass "Unauthenticated API throttle fires at request 61" \
                        || fail "Expected 429, got $code"

# ────────────────────────────────────────────────────────────
section "7. Webhook safelist (never throttled)"

info "The unauthenticated IP counter is now saturated. Webhook should still pass..."
code=$(status -X POST "$BASE_URL/api/webhooks/telegram/999" \
  -H "Content-Type: application/json" \
  -d '{}')
echo "  Webhook request → HTTP $code"
[[ "$code" != "429" ]] && pass "Webhook endpoint is safelisted (got $code, not 429)" \
                        || fail "Webhook was throttled — safelist is not working"

# ────────────────────────────────────────────────────────────
section "8. Retry-After header"

info "Checking Retry-After header on a throttled login response..."
retry_after=$(curl -s -I -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"nobody@example.com","password":"wrong"}}' \
  | grep -i 'retry-after' | awk '{print $2}' | tr -d '\r')

if [[ -n "$retry_after" ]]; then
  pass "Retry-After header present: ${retry_after}s"
else
  fail "Retry-After header missing from 429 response"
fi

echo ""
info "Done. Note: throttle counters persist until their window expires."
info "To reset quickly, flush the Rack::Attack Redis DB: redis-cli -n 0 FLUSHDB"

# ────────────────────────────────────────────────────────────
section "9. Resends (email: 3/hr per address, IP: 5/hr)"

info "Attempts 1-3: same address, should pass..."
for i in $(seq 1 3); do
  code=$(status -X POST "$BASE_URL/api/resends" \
    -H "Content-Type: application/json" \
    -d '{"user":{"email":"nobody@example.com"}}')
  echo "  Attempt $i → HTTP $code"
done

info "Attempt 4: same address — email throttle should fire (429)..."
code=$(status -X POST "$BASE_URL/api/resends" \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"nobody@example.com"}}')
echo "  Attempt 4 → HTTP $code"
[[ "$code" == "429" ]] && pass "Email throttle fires at attempt 4" \
                        || fail "Expected 429, got $code"

info "Attempt 5: different address, same IP — email quota is per-address, should pass..."
code=$(status -X POST "$BASE_URL/api/resends" \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"nobody2@example.com"}}')
echo "  Attempt 5 → HTTP $code"
[[ "$code" == "200" ]] && pass "Different address passes (per-address quota)" \
                        || fail "Expected 200, got $code"

info "Attempt 6: same IP — IP throttle should fire (429)..."
code=$(status -X POST "$BASE_URL/api/resends" \
  -H "Content-Type: application/json" \
  -d '{"user":{"email":"nobody2@example.com"}}')
echo "  Attempt 6 → HTTP $code"
[[ "$code" == "429" ]] && pass "IP throttle fires at attempt 6 (CF-Connecting-IP used as key)" \
                        || fail "Expected 429, got $code"
