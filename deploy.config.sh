# deploy.config.sh — declaration consumed by shared/scripts/deploy.sh.
# See shared/docs/DEPLOY_STANDARDIZATION_REPORT.md section 6/7 (Phase C) for the design.
# scripts/deploy.sh is still the live, authoritative deploy path.

SERVICE_NAME="agentic-email-processing-system"
PORT="3374"

IMAGES=(
  "agentic-email-processing-system|.||"
)

DEPLOYMENTS=(
  "agentic-email-processing-system|app|agentic-email-processing-system"
)

# MANIFESTS left at the runner default (configmap, external-secret, deployment,
# service, ingress) — matches the real script's manifest loop exactly.
