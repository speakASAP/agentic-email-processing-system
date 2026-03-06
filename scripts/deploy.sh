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

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         Agentic Email Processing System — Production Deployment              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

SERVICE_NAME="agentic-email-processing-system"

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

echo -e "${GREEN}✅ Found nginx-microservice at: $NGINX_MICROSERVICE_PATH${NC}"
echo -e "${GREEN}✅ Deploying service: $SERVICE_NAME${NC}"
echo ""

# Ports used by blue/green (must match docker-compose.blue.yml / docker-compose.green.yml)
PORT_BLUE="${PORT_BLUE:-3374}"
PORT_GREEN="${PORT_GREEN:-3375}"

# Free ports if occupied by our own containers (e.g. after a failed deploy or leftover containers)
if command -v docker >/dev/null 2>&1; then
    for c in agentic-email-processing-system-blue agentic-email-processing-system-green; do
        if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${c}$"; then
            echo -e "${YELLOW}Stopping and removing existing container: $c (to free port)${NC}"
            docker stop "$c" 2>/dev/null || true
            docker rm "$c" 2>/dev/null || true
        fi
    done
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

# Change to nginx-microservice directory and run deployment
echo -e "${YELLOW}Starting blue/green deployment...${NC}"
echo ""

cd "$NGINX_MICROSERVICE_PATH"

if "$DEPLOY_SCRIPT" "$SERVICE_NAME"; then
    # Canonical frontend: https://aeps.alfares.cz only (single combined config)
    AEPS_CONF="$PROJECT_ROOT/nginx/aeps.alfares.cz.conf"
    NGINX_CONF_D="$NGINX_MICROSERVICE_PATH/nginx/conf.d"
    AEPS_DEST="$NGINX_CONF_D/aeps.alfares.cz.conf"
    CERT_DIR="$NGINX_MICROSERVICE_PATH/certificates"
    NEED_RELOAD=false

    if [ -f "$AEPS_CONF" ]; then
        if [ -d "$CERT_DIR/alfares.cz" ] && [ ! -e "$CERT_DIR/aeps.alfares.cz" ]; then
            ln -sfn alfares.cz "$CERT_DIR/aeps.alfares.cz"
            echo -e "${GREEN}✅ Cert symlink: aeps.alfares.cz -> alfares.cz${NC}"
        fi
        MAIN_CERT_OK=false
        if [ -f "$CERT_DIR/agentic-email-processing-system.alfares.cz/fullchain.pem" ] && [ -f "$CERT_DIR/agentic-email-processing-system.alfares.cz/privkey.pem" ]; then
            MAIN_CERT_OK=true
        fi
        AEPS_CERT_OK=false
        if [ -f "$CERT_DIR/aeps.alfares.cz/fullchain.pem" ] && [ -f "$CERT_DIR/aeps.alfares.cz/privkey.pem" ]; then
            AEPS_CERT_OK=true
        fi
        if [ "$AEPS_CERT_OK" = true ]; then
            rm -f "$NGINX_CONF_D/00-aeps.alfares.cz.conf"
            cp "$AEPS_CONF" "$AEPS_DEST"
            echo -e "${GREEN}✅ aeps.alfares.cz config: redirect + frontend at https://aeps.alfares.cz${NC}"
            [ "$MAIN_CERT_OK" = true ] && echo -e "${GREEN}✅ Redirect: agentic-email-processing-system.alfares.cz -> https://aeps.alfares.cz${NC}"
            NEED_RELOAD=true
        elif [ -f "$AEPS_DEST" ] || [ -f "$NGINX_CONF_D/00-aeps.alfares.cz.conf" ]; then
            rm -f "$AEPS_DEST" "$NGINX_CONF_D/00-aeps.alfares.cz.conf"
            echo -e "${YELLOW}Removed aeps config (no cert for aeps.alfares.cz).${NC}"
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
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   ✅ Agentic Email Processing System deployment completed successfully!      ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Service has been deployed using blue/green deployment."
    echo "Frontend: https://aeps.alfares.cz"
    echo "Check status with:"
    echo "  cd $NGINX_MICROSERVICE_PATH"
    echo "  ./scripts/status-all-services.sh"
    exit 0
else
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
    exit 1
fi
