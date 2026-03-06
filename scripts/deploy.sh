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

# Deploy only code from repository: sync with remote (discard local changes on server)
# Only sync if NODE_ENV is set to "production"
if [ -d ".git" ]; then
    if [ "$NODE_ENV" = "production" ]; then
        echo -e "${BLUE}Production environment detected (NODE_ENV=production)${NC}"
        echo -e "${BLUE}Syncing with remote repository (discarding local changes)...${NC}"
        git fetch origin
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        git reset --hard "origin/$BRANCH"
        echo -e "${GREEN}✓ Repository synced to origin/$BRANCH${NC}"
        echo ""
    else
        echo -e "${YELLOW}Development environment detected (NODE_ENV=${NODE_ENV:-not set})${NC}"
        echo -e "${YELLOW}Skipping git sync - local changes will be preserved${NC}"
        echo ""
    fi
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      Agentic Email Processing System - Production Deployment                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Service name for nginx-microservice deploy-smart.sh (must match registry)
SERVICE_NAME="agentic-email-processing-system"
DISPLAY_NAME="Agentic Email Processing System"

# Detect nginx-microservice path
NGINX_MICROSERVICE_PATH=""
if [ -d "/home/statex/nginx-microservice" ]; then
    NGINX_MICROSERVICE_PATH="/home/statex/nginx-microservice"
elif [ -d "/home/alfares/nginx-microservice" ]; then
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
    echo "  - /home/statex/nginx-microservice"
    echo "  - /home/alfares/nginx-microservice"
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
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✅ ${DISPLAY_NAME} deployment completed successfully!               ║${NC}"
    echo -e "${GREEN}║     Total time: ${TOTAL_DURATION}s                                          ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Check status: cd $NGINX_MICROSERVICE_PATH && ./scripts/status-all-services.sh"
    exit 0
else
    END_TIME=$(get_timestamp_seconds)
    TOTAL_DURATION=$(awk "BEGIN {printf \"%.2f\", $END_TIME - $START_TIME}")
    echo ""
    echo -e "${RED}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ❌ ${DISPLAY_NAME} deployment failed! (after ${TOTAL_DURATION}s)       ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Check: $NGINX_MICROSERVICE_PATH/service-registry/$SERVICE_NAME.json"
    echo "Health: cd $NGINX_MICROSERVICE_PATH && ./scripts/blue-green/health-check.sh"
    exit 1
fi
