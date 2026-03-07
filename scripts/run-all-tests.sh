#!/bin/bash
# Run all tests: AI connectivity, endpoint tests (Ingest → Classify → Extract → Decide + triage), and CLI curl tests.
# If AEPS is not running on PORT, starts it with AI_SERVICE_URL=http://localhost:3380 so tests can pass when
# AI service is on localhost (e.g. host or port-mapped). Requires AI service reachable at AI_SERVICE_URL.
# Usage: ./scripts/run-all-tests.sh
#   AEPS_URL defaults to http://localhost:3374
#   AI_SERVICE_URL defaults to http://localhost:3380 (host); in Docker use AI_SERVICE_URL=http://ai-microservice:3380
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

AEPS_URL="${AEPS_URL:-http://localhost:3374}"
AI_SERVICE_URL="${AI_SERVICE_URL:-http://localhost:3380}"
PORT="${PORT:-3374}"
STARTED_AEPS=""

# Check if something is listening on PORT
is_listening() {
  local port=$1
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -q ":$port "; return $?
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | grep -q ":$port "; return $?
  fi
  (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null; return $?
}

# Start AEPS in background with AI_SERVICE_URL so it can reach AI on localhost
start_aeps() {
  echo "AEPS not running on port $PORT; starting with AI_SERVICE_URL=$AI_SERVICE_URL ..."
  AI_SERVICE_URL="$AI_SERVICE_URL" PORT="$PORT" node server.js &
  STARTED_AEPS=$!
  # Wait for health (up to 20s)
  local i=0
  while [ $i -lt 20 ]; do
    if curl -s -o /dev/null -w "%{http_code}" "$AEPS_URL/health" 2>/dev/null | grep -q 200; then
      echo "AEPS ready."
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "AEPS did not become ready in time."
  kill $STARTED_AEPS 2>/dev/null || true
  exit 1
}

# Ensure AEPS is running with reachable AI (for host runs)
if ! is_listening "$PORT"; then
  start_aeps
fi

export AEPS_URL
export AI_SERVICE_URL

EXIT_AI=0; EXIT_EP=0; EXIT_CLI=0

echo "=== 1. AI connectivity (AI_SERVICE_URL) ==="
set +e
npm run test:ai; EXIT_AI=$?
set -e
echo ""

echo "=== 2. Endpoint tests (Ingest → Classify → Extract → Decide + triage) ==="
set +e
npm run test:endpoints; EXIT_EP=$?
set -e
echo ""

echo "=== 3. CLI curl tests ==="
set +e
./scripts/test-api-from-cli.sh; EXIT_CLI=$?
set -e
echo ""

if [ -n "$STARTED_AEPS" ]; then
  kill $STARTED_AEPS 2>/dev/null || true
  echo "Stopped AEPS (was started by this script)."
fi

if [ "$EXIT_AI" -ne 0 ] || [ "$EXIT_EP" -ne 0 ] || [ "$EXIT_CLI" -ne 0 ]; then
  echo "Some tests failed (test:ai=$EXIT_AI test:endpoints=$EXIT_EP test-api-from-cli=$EXIT_CLI)."
  exit 1
fi
echo "All tests passed."
exit 0
