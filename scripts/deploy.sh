#!/bin/bash
# Agentic Email Processing System — Production Deployment Script
# Usage: ./scripts/deploy.sh
#
# Deploys the agentic-email-processing-system to production using the
# nginx-microservice blue/green deployment system.
#
# Detects nginx-microservice location and calls deploy-smart.sh to perform deployment.

set -e

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load NODE_ENV from .env file to determine environment
NODE_ENV=""
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$PROJECT_ROOT/.env" 2>/dev/null || true
    set +a
    NODE_ENV="${NODE_ENV:-}"
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        Agentic Email Processing System - Production Deployment                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Service name for nginx-microservice deploy-smart.sh (must match registry)
SERVICE_NAME="${SERVICE_NAME:-agentic-email-processing-system}"
DISPLAY_NAME="Agentic Email Processing System"

# Ports used by this service (blue=3374, green=3375) — free them before deploy to avoid "port already allocated"
PORT_BLUE="${PORT_BLUE:-3374}"
PORT_GREEN="${PORT_GREEN:-3375}"

# Stop and remove any container currently binding our ports so deploy-smart.sh can start green
free_our_ports() {
    local id name rest count=0
    echo -e "${BLUE}Checking for containers using port ${PORT_BLUE}/${PORT_GREEN}...${NC}"
    local docker_out
    if command -v timeout >/dev/null 2>&1; then
        docker_out=$(timeout 15 docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' 2>/dev/null) || docker_out=""
    else
        docker_out=$(docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' 2>/dev/null) || docker_out=""
    fi
    while read -r id name rest; do
        [ -z "$id" ] && continue
        echo -e "${YELLOW}Stopping container using port ${PORT_BLUE}/${PORT_GREEN}: $name${NC}"
        docker stop "$id" 2>/dev/null || true
        docker rm -f "$id" 2>/dev/null || true
        count=$((count + 1))
    done < <(echo "$docker_out" | grep -E ":(${PORT_BLUE}|${PORT_GREEN})->" || true)
    [ "$count" -gt 0 ] && echo -e "${GREEN}✓ Ports ${PORT_BLUE}/${PORT_GREEN} freed${NC}" && sleep 1
}

free_our_ports

echo -e "${BLUE}Locating nginx-microservice...${NC}"
# Detect nginx-microservice path (production: alfares.cz server)
NGINX_MICROSERVICE_PATH=""
if [ -d "/home/alfares/nginx-microservice" ]; then
    NGINX_MICROSERVICE_PATH="/home/alfares/nginx-microservice"
elif [ -d "$HOME/nginx-microservice" ]; then
    NGINX_MICROSERVICE_PATH="$HOME/nginx-microservice"
elif [ -d "$(dirname "$PROJECT_ROOT")/nginx-microservice" ]; then
    NGINX_MICROSERVICE_PATH="$(dirname "$PROJECT_ROOT")/nginx-microservice"
elif [ -d "$PROJECT_ROOT/../nginx-microservice" ]; then
    NGINX_MICROSERVICE_PATH="$(cd "$PROJECT_ROOT/../nginx-microservice" && pwd)"
fi

if [ -z "$NGINX_MICROSERVICE_PATH" ] || [ ! -d "$NGINX_MICROSERVICE_PATH" ]; then
    echo -e "${RED}❌ Error: nginx-microservice not found${NC}"
    echo ""
    echo "Ensure nginx-microservice is in one of:"
    echo "  - /home/alfares/nginx-microservice (production)"
    echo "  - $HOME/nginx-microservice"
    echo "  - $(dirname "$PROJECT_ROOT")/nginx-microservice"
    echo ""
    echo "Or set: export NGINX_MICROSERVICE_PATH=/path/to/nginx-microservice"
    exit 1
fi

DEPLOY_SCRIPT="$NGINX_MICROSERVICE_PATH/scripts/blue-green/deploy-smart.sh"
if [ ! -f "$DEPLOY_SCRIPT" ]; then
    echo -e "${RED}❌ Error: deploy-smart.sh not found at $DEPLOY_SCRIPT${NC}"
    exit 1
fi
[ ! -x "$DEPLOY_SCRIPT" ] && chmod +x "$DEPLOY_SCRIPT"

echo -e "${GREEN}✅ Found nginx-microservice at: $NGINX_MICROSERVICE_PATH${NC}"
echo -e "${GREEN}✅ Deploying service: $SERVICE_NAME${NC}"
echo ""

# Phase timing (optional)
PHASE_TIMING_FILE=$(mktemp /tmp/deploy-phases-XXXXXX)
trap "rm -f $PHASE_TIMING_FILE" EXIT

get_timestamp_seconds() { date +%s.%N; }
START_TIME=$(get_timestamp_seconds)

log_with_timestamp() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log_with_timestamp "Starting blue/green deployment..."
log_with_timestamp "Executing: $DEPLOY_SCRIPT $SERVICE_NAME"
cd "$NGINX_MICROSERVICE_PATH"

if "$DEPLOY_SCRIPT" "$SERVICE_NAME"; then
    END_TIME=$(get_timestamp_seconds)
    TOTAL_DURATION=$(awk "BEGIN {printf \"%.2f\", $END_TIME - $START_TIME}")
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║ ✅ Agentic Email Processing System deployment completed successfully! ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════════╝${NC}"
    echo -e "${GREEN}Total time: ${TOTAL_DURATION}s${NC}"
    echo ""
    echo "Check status: cd $NGINX_MICROSERVICE_PATH && ./scripts/status-all-services.sh"
    exit 0
else
    END_TIME=$(get_timestamp_seconds)
    TOTAL_DURATION=$(awk "BEGIN {printf \"%.2f\", $END_TIME - $START_TIME}")
    echo ""
    echo -e "${RED}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║      ❌ Agentic Email Processing System deployment failed!           ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo -e "${RED}Total duratyion: ${TOTAL_DURATION}s)${NC}"
    echo ""
    echo "Check: $NGINX_MICROSERVICE_PATH/service-registry/$SERVICE_NAME.json"
    echo "Health: cd $NGINX_MICROSERVICE_PATH && ./scripts/blue-green/health-check.sh"
    exit 1
fi
