#!/bin/bash
# Run all tests: AI connectivity, endpoint tests (Ingest → Classify → Extract → Decide + triage), and CLI curl tests.
# Starts AEPS on a dedicated test port with AI_SERVICE_URL so it can reach AI on localhost; then runs all tests.
# Requires AI service reachable at AI_SERVICE_URL (default http://localhost:3380).
# Usage: ./scripts/run-all-tests.sh
#   AEPS_URL is set to the test instance (http://localhost:TEST_PORT).
#   AI_SERVICE_URL defaults to http://localhost:3380 (host); in Docker use AI_SERVICE_URL=http://ai-microservice:3380
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

AI_SERVICE_URL="${AI_SERVICE_URL:-http://localhost:3380}"
# Use dedicated test port so we control AEPS env (no conflict with existing AEPS on 3374)
# Try 3376, 3377, 3378 if port is in use
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

# Find a free port in 3376-3378 (or use TEST_PORT if set)
find_test_port() {
  if [ -n "$TEST_PORT" ]; then
    echo "$TEST_PORT"
    return
  fi
  for p in 3376 3377 3378; do
    if ! is_listening "$p"; then
      echo "$p"
      return
    fi
  done
  echo "3378"
}

TEST_PORT=$(find_test_port)
if is_listening "$TEST_PORT"; then
  echo "No free test port in 3376-3378; set TEST_PORT to an available port."
  exit 1
fi
AEPS_URL="http://localhost:$TEST_PORT"

# Start AEPS in background on TEST_PORT with AI_SERVICE_URL so it can reach AI on localhost
start_aeps() {
  echo "Starting AEPS on port $TEST_PORT with AI_SERVICE_URL=$AI_SERVICE_URL ..."
  AI_SERVICE_URL="$AI_SERVICE_URL" PORT="$TEST_PORT" node server.js &
  STARTED_AEPS=$!
  # Wait for health (up to 25s)
  local i=0
  while [ $i -lt 25 ]; do
    if curl -s -o /dev/null -w "%{http_code}" "$AEPS_URL/health" 2>/dev/null | grep -q 200; then
      echo "AEPS ready at $AEPS_URL"
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "AEPS did not become ready in time."
  kill $STARTED_AEPS 2>/dev/null || true
  exit 1
}

# Always start our own AEPS for testing so it has correct AI_SERVICE_URL
start_aeps

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

echo "=== 4. AI via ai-microservice:3380 (mandatory; same URL used by AEPS in Docker) ==="
EXIT_AEPS_URL=0
RUN_MANDATORY_CHECK() {
  set +e
  AI_SERVICE_URL=http://ai-microservice:3380 node scripts/check-ai-connectivity.js
  local ret=$?
  set -e
  return $ret
}

if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 6 "http://ai-microservice:3380/health" 2>/dev/null | grep -q 200; then
  echo "ai-microservice:3380 reachable from host; running mandatory connectivity + ingest check..."
  RUN_MANDATORY_CHECK || { EXIT_AEPS_URL=$?; echo "FAIL: Mandatory check failed — AI at http://ai-microservice:3380 unreachable or ingest failed (crucial for infrastructure)."; }
else
  echo "ai-microservice:3380 not reachable from host; running mandatory check from container on nginx-network..."
  if command -v docker >/dev/null 2>&1 && docker network inspect nginx-network >/dev/null 2>&1; then
    set +e
    AI_SERVICE_URL=http://ai-microservice:3380 docker compose run --rm app node scripts/check-ai-connectivity.js
    EXIT_AEPS_URL=$?
    set -e
    if [ "$EXIT_AEPS_URL" -ne 0 ]; then
      echo "FAIL: Mandatory check failed — AI at http://ai-microservice:3380 unreachable or ingest failed (crucial for infrastructure)."
    fi
  else
    echo "FAIL: Mandatory check could not run. ai-microservice:3380 is not reachable from host and Docker/nginx-network is not available."
    echo "  Ensure either: (1) AI is reachable at http://ai-microservice:3380 from this host, or (2) Docker is available and nginx-network exists with ai-microservice running."
    EXIT_AEPS_URL=1
  fi
fi
if [ "$EXIT_AEPS_URL" -ne 0 ]; then
  echo "  This check cannot be skipped; AEPS in production depends on it."
fi
echo ""

if [ -n "$STARTED_AEPS" ]; then
  kill $STARTED_AEPS 2>/dev/null || true
  echo "Stopped AEPS (was started by this script)."
fi

if [ "$EXIT_AI" -ne 0 ] || [ "$EXIT_EP" -ne 0 ] || [ "$EXIT_CLI" -ne 0 ] || [ "$EXIT_AEPS_URL" -ne 0 ]; then
  echo "Some tests failed (test:ai=$EXIT_AI test:endpoints=$EXIT_EP test-api-from-cli=$EXIT_CLI ai-microservice:3380=$EXIT_AEPS_URL)."
  exit 1
fi
echo "All tests passed."
exit 0
