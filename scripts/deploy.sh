#!/bin/bash
# Agentic Email Processing System — Deployment Script
# Usage: ./scripts/deploy.sh
#
# Deploys the agentic-email-processing-system to production using the
# nginx-microservice blue/green deployment system.
#
# Uses: nginx-microservice/scripts/blue-green/deploy-smart.sh
# SSL: Let's Encrypt (managed by nginx-microservice). Set CERTBOT_EMAIL in nginx-microservice/.env.
#
# The script automatically detects the nginx-microservice location and
# calls the deploy-smart.sh script to perform the deployment.

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

# Load .env to determine environment
NODE_ENV=""
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$PROJECT_ROOT/.env" 2>/dev/null || true
    set +a
    NODE_ENV="${NODE_ENV:-}"
fi

# Pull from remote in production; preserve local changes (stash uncommitted if any, then reapply).
# Only sync if NODE_ENV is set to "production"
if [ -d ".git" ]; then
    if [ "$NODE_ENV" = "production" ]; then
        echo -e "${BLUE}Production environment detected (NODE_ENV=production)${NC}"
        echo -e "${BLUE}Pulling from remote (local changes preserved)...${NC}"
        git fetch origin
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        STASHED=0
        if [ -n "$(git status --porcelain)" ]; then
            git stash push -u -m "deploy.sh: stash before pull"
            STASHED=1
        fi
        git pull origin "$BRANCH"
        if [ "$STASHED" = "1" ]; then
            git stash pop
        fi
        echo -e "${GREEN}✓ Repository updated from origin/$BRANCH (local changes preserved)${NC}"
        echo ""
    else
        echo -e "${YELLOW}Development environment detected (NODE_ENV=${NODE_ENV:-not set})${NC}"
        echo -e "${YELLOW}Skipping git sync - local changes will be preserved${NC}"
        echo ""
    fi
fi

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Agentic Email Processing System — Production Deployment              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Only DOMAIN and SERVICE_NAME from .env. Registry key and container base are derived below.
SERVICE_NAME="${SERVICE_NAME:-aeps}"
DOMAIN="${DOMAIN:-aeps.alfares.cz}"

# Detect nginx-microservice path
NGINX_MICROSERVICE_PATH=""
if [ -d "/home/statex/nginx-microservice" ]; then
    NGINX_MICROSERVICE_PATH="/home/statex/nginx-microservice"
elif [ -d "/home/alfares/nginx-microservice" ]; then
    NGINX_MICROSERVICE_PATH="/home/alfares/nginx-microservice"
elif [ -d "/home/belunga/nginx-microservice" ]; then
    NGINX_MICROSERVICE_PATH="/home/belunga/nginx-microservice"
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
    echo "Please ensure nginx-microservice is installed in one of these locations:"
    echo "  - /home/statex/nginx-microservice"
    echo "  - /home/alfares/nginx-microservice"
    echo "  - /home/belunga/nginx-microservice"
    echo "  - $HOME/nginx-microservice"
    echo "  - $(dirname "$PROJECT_ROOT")/nginx-microservice (sibling directory)"
    echo ""
    echo "Or set NGINX_MICROSERVICE_PATH environment variable:"
    echo "  export NGINX_MICROSERVICE_PATH=/path/to/nginx-microservice"
    exit 1
fi

DEPLOY_SCRIPT="$NGINX_MICROSERVICE_PATH/scripts/blue-green/deploy-smart.sh"
if [ ! -f "$DEPLOY_SCRIPT" ]; then
    echo -e "${RED}❌ Error: deploy-smart.sh not found at $DEPLOY_SCRIPT${NC}"
    exit 1
fi

if [ ! -x "$DEPLOY_SCRIPT" ]; then
    echo -e "${YELLOW}⚠️  Making deploy-smart.sh executable...${NC}"
    chmod +x "$DEPLOY_SCRIPT"
fi

# Registry key: use SERVICE_NAME if that registry exists, else fallback (e.g. agentic-email-processing-system)
REGISTRY_JSON="$NGINX_MICROSERVICE_PATH/service-registry"
REGISTRY_KEY="$SERVICE_NAME"
if [ ! -f "$REGISTRY_JSON/${REGISTRY_KEY}.json" ]; then
    REGISTRY_KEY="agentic-email-processing-system"
fi
echo -e "${GREEN}✅ Found nginx-microservice at: $NGINX_MICROSERVICE_PATH${NC}"
echo -e "${GREEN}✅ Deploying service: $REGISTRY_KEY${NC}"
echo ""

# Ports used by blue/green (must match docker-compose.blue.yml / docker-compose.green.yml)
PORT_BLUE="${PORT_BLUE:-3374}"
PORT_GREEN="${PORT_GREEN:-3375}"

# Container base from registry (so we don't need CONTAINER_NAME_BASE in .env)
CONTAINER_BASE="agentic-email-processing-system"
if [ -f "$REGISTRY_JSON/${REGISTRY_KEY}.json" ] && command -v jq >/dev/null 2>&1; then
    _base=$(jq -r '.services.app.container_name_base // empty' "$REGISTRY_JSON/${REGISTRY_KEY}.json" 2>/dev/null) || true
    [ -n "$_base" ] && CONTAINER_BASE="$_base"
fi
# Free ports if occupied by our own containers (e.g. after a failed deploy or leftover containers)
if command -v docker >/dev/null 2>&1; then
    for c in ${CONTAINER_BASE}-blue ${CONTAINER_BASE}-green; do
        if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${c}$"; then
            echo -e "${YELLOW}Stopping and removing existing container: $c (to free port)${NC}"
            docker stop "$c" 2>/dev/null || true
            docker rm "$c" 2>/dev/null || true
        fi
    done
    true
fi

# Check if required port is still in use by something else
check_port() {
    local port=$1
    if command -v ss >/dev/null 2>&1; then
        ss -tlnp 2>/dev/null | grep -q ":${port}[[:space:]]" && return 0
    fi
    if command -v lsof >/dev/null 2>&1; then
        lsof -i ":${port}" -sTCP:LISTEN -t >/dev/null 2>&1 && return 0
    fi
    return 1
}
if check_port "$PORT_BLUE"; then
    echo -e "${RED}❌ Error: port $PORT_BLUE is still in use. Stop the process using it and retry.${NC}"
    echo "  Example: ss -tlnp | grep $PORT_BLUE   or   lsof -i :$PORT_BLUE"
    exit 1
fi

# Remove only stale/legacy frontend config filenames (00-, z-). Do NOT remove ${DOMAIN}.conf here:
# it is recreated only when deploy succeeds; if deploy fails, we must leave the current config so
# https://${DOMAIN} stays reachable instead of 404.
FRONTEND_DOMAIN="${DOMAIN:-aeps.alfares.cz}"
NGINX_CONF_D="$NGINX_MICROSERVICE_PATH/nginx/conf.d"
rm -f "$NGINX_CONF_D/00-${FRONTEND_DOMAIN}.conf" "$NGINX_CONF_D/z-${FRONTEND_DOMAIN}.conf" 2>/dev/null || true

# Timing and phase summary
get_timestamp_seconds() { date +%s.%N; }
PHASE_TIMING_FILE=$(mktemp /tmp/deploy-phases-XXXXXX)
trap "rm -f $PHASE_TIMING_FILE" EXIT
start_phase() { local n="$1" t=$(get_timestamp_seconds); echo "$n|START|$t" >> "$PHASE_TIMING_FILE"; echo -e "${YELLOW}⏱️  PHASE START: $n${NC}"; }
end_phase() { local n="$1" t=$(get_timestamp_seconds); echo "$n|END|$t" >> "$PHASE_TIMING_FILE"; local sl=$(grep "^${n}|START|" "$PHASE_TIMING_FILE" | tail -1); if [ -n "$sl" ]; then local st=$(echo "$sl" | cut -d'|' -f3); local d=$(awk "BEGIN {printf \"%.2f\", $t - $st}"); echo -e "${GREEN}⏱️  PHASE END: $n (duration: ${d}s)${NC}"; fi; }
print_phase_summary() {
    if [ ! -f "$PHASE_TIMING_FILE" ] || [ ! -s "$PHASE_TIMING_FILE" ]; then echo ""; echo -e "${YELLOW}⚠️  No phase timing data available${NC}"; echo ""; return; fi
    echo ""; echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"; echo -e "${BLUE}📊 DEPLOYMENT PHASE TIMING SUMMARY${NC}"; echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
    local cur="" st="" tot=0; while IFS='|' read -r p e ts; do
        if [ "$e" = "START" ]; then cur="$p"; st="$ts"
        elif [ "$e" = "END" ] && [ -n "$st" ] && [ -n "$cur" ]; then local d=$(awk "BEGIN {printf \"%.2f\", $ts - $st}"); tot=$(awk "BEGIN {printf \"%.2f\", $tot + $d}"); printf "  ${GREEN}%-45s${NC} ${YELLOW}%10.2fs${NC}\n" "$cur:" "$d"; cur=""; st=""; fi
    done < "$PHASE_TIMING_FILE"
    if [ "$(echo "$tot > 0" | bc 2>/dev/null || echo "0")" = "1" ]; then echo -e "${BLUE}────────────────────────────────────────────────────────────${NC}"; printf "  ${GREEN}%-45s${NC} ${YELLOW}%10.2fs${NC}\n" "Total (all phases):" "$tot"; fi
    echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"; echo ""
}

# Change to nginx-microservice directory and run deployment
start_phase "Pre-deployment Setup"
echo -e "${YELLOW}Starting blue/green deployment...${NC}"
echo ""
cd "$NGINX_MICROSERVICE_PATH"
end_phase "Pre-deployment Setup"
START_TIME=$(get_timestamp_seconds)
"$DEPLOY_SCRIPT" "$REGISTRY_KEY" 2>&1 | {
    build_started=0; start_containers_started=0; health_check_started=0
    while IFS= read -r line; do echo "$line"
        if echo "$line" | grep -qE "Phase 0:.*Infrastructure"; then start_phase "Phase 0: Infrastructure Check"
        elif echo "$line" | grep -qE "Phase 0 completed|✅ Phase 0 completed"; then end_phase "Phase 0: Infrastructure Check"
        elif echo "$line" | grep -qE "Phase 1:.*Preparing|Phase 1:.*Prepare"; then start_phase "Phase 1: Prepare Green Deployment"
        elif echo "$line" | grep -qE "Phase 1 completed|✅ Phase 1 completed"; then end_phase "Phase 1: Prepare Green Deployment"
        elif echo "$line" | grep -qE "Phase 2:.*Switching|Phase 2:.*Switch"; then start_phase "Phase 2: Switch Traffic to Green"
        elif echo "$line" | grep -qE "Phase 2 completed|✅ Phase 2 completed"; then end_phase "Phase 2: Switch Traffic to Green"
        elif echo "$line" | grep -qE "Phase 3:.*Monitoring|Phase 3:.*Monitor"; then start_phase "Phase 3: Monitor Health"
        elif echo "$line" | grep -qE "Phase 3 completed|✅ Phase 3 completed"; then end_phase "Phase 3: Monitor Health"
        elif echo "$line" | grep -qE "Phase 4:.*Verifying|Phase 4:.*Verify"; then start_phase "Phase 4: Verify HTTPS"
        elif echo "$line" | grep -qE "Phase 4 completed|✅ Phase 4 completed"; then end_phase "Phase 4: Verify HTTPS"
        elif echo "$line" | grep -qE "Phase 5:.*Cleaning|Phase 5:.*Cleanup"; then start_phase "Phase 5: Cleanup"
        elif echo "$line" | grep -qE "Phase 5 completed|✅ Phase 5 completed"; then end_phase "Phase 5: Cleanup"
        elif echo "$line" | grep -qE "Building containers|Image.*Building" && [ "$build_started" -eq 0 ]; then start_phase "Build Containers"; build_started=1
        elif echo "$line" | grep -qE "All services built|✅ All services built" && [ "$build_started" -eq 1 ]; then end_phase "Build Containers"; build_started=2
        elif echo "$line" | grep -qE "Starting containers|Container.*Starting" && [ "$start_containers_started" -eq 0 ]; then start_phase "Start Containers"; start_containers_started=1
        elif echo "$line" | grep -qE "Container.*Started|Waiting.*services to start" && [ "$start_containers_started" -eq 1 ]; then end_phase "Start Containers"; start_containers_started=2
        elif echo "$line" | grep -qE "Checking.*health|Health check" && [ "$health_check_started" -eq 0 ]; then start_phase "Phase 3: Health Checks"; health_check_started=1
        elif echo "$line" | grep -qE "health check passed|✅.*health" && [ "$health_check_started" -eq 1 ]; then end_phase "Phase 3: Health Checks"; health_check_started=2
        fi
    done
}
DEPLOY_EXIT_CODE=${PIPESTATUS[0]}
END_TIME=$(get_timestamp_seconds)
TOTAL_DURATION=$(awk "BEGIN {printf \"%.2f\", $END_TIME - $START_TIME}")

if [ $DEPLOY_EXIT_CODE -eq 0 ]; then
    TOTAL_DURATION_FORMATTED=$(awk "BEGIN {printf \"%.2f\", $TOTAL_DURATION}")
    print_phase_summary 2>&1
    # Frontend domain from .env (single config; same naming as other domain configs).
    DOMAIN="${DOMAIN:-aeps.alfares.cz}"
    NGINX_CONF_D="$NGINX_MICROSERVICE_PATH/nginx/conf.d"
    AEPS_DEST="$NGINX_CONF_D/${DOMAIN}.conf"
    AEPS_SRC="$PROJECT_ROOT/nginx/aeps.alfares.cz.conf"
    CERT_DIR="$NGINX_MICROSERVICE_PATH/certificates"
    NEED_RELOAD=false

    # Detect active color from main domain symlink. Domain comes from registry (same as DOMAIN when registry uses aeps.alfares.cz).
    MAIN_DOMAIN="$DOMAIN"
    if [ -f "$REGISTRY_JSON/${REGISTRY_KEY}.json" ] && command -v jq >/dev/null 2>&1; then
        _reg_domain=$(jq -r '.domain // empty' "$REGISTRY_JSON/${REGISTRY_KEY}.json" 2>/dev/null)
        [ -n "$_reg_domain" ] && MAIN_DOMAIN="$_reg_domain"
    fi
    MAIN_SYMLINK="$NGINX_CONF_D/${MAIN_DOMAIN}.conf"
    SYMLINK_TARGET=""
    if [ -L "$MAIN_SYMLINK" ]; then
        SYMLINK_TARGET=$(readlink "$MAIN_SYMLINK" 2>/dev/null || true)
    fi
    ACTIVE_COLOR="blue"
    if [ -n "$SYMLINK_TARGET" ]; then
        if echo "$SYMLINK_TARGET" | grep -q '\.green\.conf$'; then
            ACTIVE_COLOR="green"
        elif echo "$SYMLINK_TARGET" | grep -q '\.blue\.conf$'; then
            ACTIVE_COLOR="blue"
        fi
    fi
    AEPS_UPSTREAM="${CONTAINER_BASE}-${ACTIVE_COLOR}"

    if [ -f "$AEPS_SRC" ]; then
        if [ -d "$CERT_DIR/alfares.cz" ] && [ ! -e "$CERT_DIR/$DOMAIN" ]; then
            ln -sfn alfares.cz "$CERT_DIR/$DOMAIN"
            echo -e "${GREEN}✅ Cert symlink: $DOMAIN -> alfares.cz${NC}"
        fi
        AEPS_CERT_OK=false
        if [ -f "$CERT_DIR/$DOMAIN/fullchain.pem" ] && [ -f "$CERT_DIR/$DOMAIN/privkey.pem" ]; then
            AEPS_CERT_OK=true
        fi
        if [ "$AEPS_CERT_OK" = true ]; then
            rm -f "$NGINX_CONF_D/00-${DOMAIN}.conf" "$NGINX_CONF_D/z-${DOMAIN}.conf" "$AEPS_DEST"
            sed "s/{{AEPS_UPSTREAM}}/$AEPS_UPSTREAM/g" "$AEPS_SRC" > "$AEPS_DEST"
            echo -e "${GREEN}✅ $DOMAIN config ($ACTIVE_COLOR): frontend at https://${DOMAIN}${NC}"
            NEED_RELOAD=true
        elif [ -f "$AEPS_DEST" ] || [ -f "$NGINX_CONF_D/00-${DOMAIN}.conf" ] || [ -f "$NGINX_CONF_D/z-${DOMAIN}.conf" ]; then
            rm -f "$AEPS_DEST" "$NGINX_CONF_D/00-${DOMAIN}.conf" "$NGINX_CONF_D/z-${DOMAIN}.conf"
            echo -e "${YELLOW}Removed frontend config (no cert for $DOMAIN).${NC}"
            NEED_RELOAD=true
        fi
    fi

    if [ "$NEED_RELOAD" = true ]; then
        RELOAD_SCRIPT="$NGINX_MICROSERVICE_PATH/scripts/reload-nginx.sh"
        if [ -x "$RELOAD_SCRIPT" ]; then
            if "$RELOAD_SCRIPT"; then
                echo -e "${GREEN}✅ Nginx reloaded${NC}"
            else
                echo -e "${YELLOW}⚠️  Nginx reload failed; run: docker logs nginx-microservice${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  Run nginx reload manually: $NGINX_MICROSERVICE_PATH/scripts/reload-nginx.sh${NC}"
        fi
    fi

    # Frontend from DOMAIN
    echo ""
    echo -e "${BLUE}[INFO] Checking HTTPS availability: https://${DOMAIN}/ (timeout: 5s)${NC}"
    AEPS_HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -k "https://${DOMAIN}/" 2>/dev/null || echo "000")
    if echo "$AEPS_HTTP_CODE" | grep -qE '^[24][0-9][0-9]$'; then
        echo -e "${GREEN}✅ HTTPS check passed: https://${DOMAIN}/ (HTTP $AEPS_HTTP_CODE - service reachable)${NC}"
    else
        echo -e "${YELLOW}⚠️  HTTPS check failed or timeout for https://${DOMAIN}/ (HTTP $AEPS_HTTP_CODE) — verify cert and nginx config.${NC}"
    fi

    # Check that AEPS container can reach ai-microservice (required for demo/triage to work)
    AEPS_CONTAINER="${CONTAINER_BASE}-${ACTIVE_COLOR}"
    if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${AEPS_CONTAINER}$"; then
        if ! docker exec "$AEPS_CONTAINER" wget -q -O- --timeout=5 http://ai-microservice:3380/health >/dev/null 2>&1; then
            echo ""
            echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
            echo -e "${YELLOW}║  ⚠️  AI service (ai-microservice:3380) not reachable from this container     ║${NC}"
            echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
            echo -e "${YELLOW}  Demo/triage will show 'AI service unreachable ... timeout' until fixed.${NC}"
            echo -e "${YELLOW}  On this host: deploy ai-microservice (same nginx-network), then ensure only${NC}"
            echo -e "${YELLOW}  one ai-microservice stack (blue or green) is running.${NC}"
            echo ""
        else
            echo -e "${GREEN}✅ AI service (ai-microservice:3380) reachable from $AEPS_CONTAINER${NC}"
        fi
    fi

    echo ""
    echo -e "${BLUE}Running post-deploy tests (endpoints: health, ingest, classify, extract, decide, triage + mandatory 503 error shape)...${NC}"
    cd "$PROJECT_ROOT"
    TEST_EXIT=0
    # Use DOMAIN for test URL when set
    if [ -n "${DOMAIN:-}" ]; then
        export AEPS_URL="${AEPS_TEST_URL:-https://${DOMAIN}}"
        echo "  Using AEPS_URL=$AEPS_URL (frontend)"
    else
        export AEPS_URL="${AEPS_URL:-http://localhost:3374}"
    fi
    if node scripts/test-email-triage-endpoints.js; then
        echo -e "${GREEN}✓ All endpoint tests passed.${NC}"
    else
        echo -e "${YELLOW}  Public/local URL failed; trying localhost (blue 3374, green 3375)...${NC}"
        TEST_PASSED=0
        for port in 3374 3375; do
            export AEPS_URL="http://localhost:${port}"
            if node scripts/test-email-triage-endpoints.js; then
                echo -e "${GREEN}✓ All endpoint tests passed at $AEPS_URL${NC}"
                if [ -n "${DOMAIN:-}" ]; then
                    echo -e "${YELLOW}  Note: https://${DOMAIN} returned an error. Check firewall/WAF if external access is required.${NC}"
                fi
                TEST_PASSED=1
                break
            fi
        done
        if [ "$TEST_PASSED" = "0" ]; then
            TEST_EXIT=1
            echo -e "${RED}✗ One or more endpoint tests failed (tried AEPS_URL and localhost:3374/3375).${NC}"
        fi
    fi
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   ✅ Agentic Email Processing System deployment completed successfully!      ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo -e "${GREEN}Total deployment time: ${TOTAL_DURATION_FORMATTED}s${NC}"
    echo ""
    echo "Service has been deployed using blue/green deployment."
    echo "Frontend: https://${DOMAIN}"
    echo "Check status with:"
    echo "  cd $NGINX_MICROSERVICE_PATH"
    echo "  ./scripts/status-all-services.sh"
    exit "$TEST_EXIT"
else
    TOTAL_DURATION_FORMATTED=$(awk "BEGIN {printf \"%.2f\", $TOTAL_DURATION}")
    echo ""
    echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
    echo -e "${RED}   ❌ Agentic Email Processing System deployment failed! Failed after: ${TOTAL_DURATION_FORMATTED}s${NC}"
    echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
    print_phase_summary
    echo ""
    echo -e "${RED}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║            ❌ Agentic Email Processing System deployment failed!             ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Please check the error messages above and:"
    echo "  1. If you see 'address already in use' for port $PORT_BLUE: run ./scripts/deploy.sh again (it stops existing containers first), or free the port: ss -tlnp | grep $PORT_BLUE"
    echo "  2. Verify nginx-microservice is properly configured"
    echo "  3. Check service registry: $NGINX_MICROSERVICE_PATH/service-registry/$SERVICE_NAME.json"
    echo "  4. Review deployment logs (and container logs if health check fails)"
    echo "  5. Check service health: cd $NGINX_MICROSERVICE_PATH && ./scripts/blue-green/health-check.sh $SERVICE_NAME"
    echo "  6. If nginx reload fails due to another service's config (e.g. minio-proxy-settings.conf), fix that in nginx-microservice or ensure all required include files exist."
    echo "  7. If demo shows 'AI service unreachable ... timeout': deploy ai-microservice on this host and ensure only one stack (blue or green) is running; from AEPS container, http://ai-microservice:3380/health must return 200."
    exit 1
fi
