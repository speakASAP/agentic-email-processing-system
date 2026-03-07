#!/bin/bash
# Test email-triage and agentic-email API from command line (no GUI).
# Usage: ./scripts/test-api-from-cli.sh
#   AEPS_URL defaults to http://localhost:3374 (agentic-email); set if behind nginx or different port.
#   AI_SERVICE_URL defaults to http://localhost:3380 for direct AI tests from host.
set -e

AEPS_URL="${AEPS_URL:-http://localhost:3374}"
AI_DIRECT="${AI_SERVICE_URL:-http://localhost:3380}"
INGEST_BODY='{"message_id":"cli-test","tenant_id":"demo","timestamp":"2026-03-07T12:00:00.000Z","sender":"mark.jensen@example.com","recipients":["support@example.com"],"subject":"Unable to access my dashboard","body_plain":"Hi, I logged in but my dashboard is empty. Thanks, Mark","attachments":[]}'

echo "AEPS_URL=$AEPS_URL  AI_DIRECT=$AI_DIRECT"
echo ""

echo "=== 1. Direct AI: POST $AI_DIRECT/api/email-triage/ingest ==="
t0=$(date +%s.%N)
code=$(curl -s -o /tmp/ai_ingest.json -w "%{http_code}" -X POST "$AI_DIRECT/api/email-triage/ingest" -H "Content-Type: application/json" -d "$INGEST_BODY" --max-time 10)
t1=$(date +%s.%N)
elapsed=$(awk "BEGIN {printf \"%.0f\", ($t1 - $t0) * 1000}")
if [ "$code" = "200" ]; then
  echo "   HTTP $code  ${elapsed}ms  OK"
  grep -q '"success":true' /tmp/ai_ingest.json && echo "   success: true"
else
  echo "   HTTP $code  ${elapsed}ms  FAIL"
  head -c 300 /tmp/ai_ingest.json; echo
fi
echo ""

echo "=== 2. Agentic-email: POST $AEPS_URL/api/ingest ==="
t0=$(date +%s.%N)
code=$(curl -s -o /tmp/ae_ingest.json -w "%{http_code}" -X POST "$AEPS_URL/api/ingest" -H "Content-Type: application/json" -d "$INGEST_BODY" --max-time 15)
t1=$(date +%s.%N)
elapsed=$(awk "BEGIN {printf \"%.0f\", ($t1 - $t0) * 1000}")
if [ "$code" = "200" ]; then
  echo "   HTTP $code  ${elapsed}ms  OK"
  grep -q '"success":true' /tmp/ae_ingest.json && echo "   success: true"
else
  echo "   HTTP $code  ${elapsed}ms  FAIL"
  head -c 300 /tmp/ae_ingest.json; echo
fi
echo ""

echo "=== 3. Agentic-email: POST $AEPS_URL/api/triage (full pipeline) ==="
t0=$(date +%s.%N)
code=$(curl -s -o /tmp/ae_triage.json -w "%{http_code}" -X POST "$AEPS_URL/api/triage" -H "Content-Type: application/json" -d "$INGEST_BODY" --max-time 30)
t1=$(date +%s.%N)
elapsed=$(awk "BEGIN {printf \"%.0f\", ($t1 - $t0) * 1000}")
if [ "$code" = "200" ]; then
  echo "   HTTP $code  ${elapsed}ms  OK"
  grep -q '"success":true' /tmp/ae_triage.json && echo "   success: true"
  grep -o '"intent":"[^"]*"' /tmp/ae_triage.json | head -1
  grep -o '"action":"[^"]*"' /tmp/ae_triage.json | head -1
else
  echo "   HTTP $code  ${elapsed}ms  FAIL"
  head -c 400 /tmp/ae_triage.json; echo
fi
echo ""

echo "=== 4. Agentic-email: GET $AEPS_URL/health ==="
curl -s -o /tmp/ae_health.json -w "   HTTP %{http_code}  %{time_total}s\n" "$AEPS_URL/health"
head -c 200 /tmp/ae_health.json; echo
echo ""

echo "Done. Failures above indicate AI unreachable or timeout (check AEPS_URL and AI_SERVICE_URL)."
