# Agentic Email Processing System

## status

The Agentic Email Processing System is a production service (STATE.json: `production`) that autonomously triages inbound business email using the shared ai-microservice, with a built-in web UI over a 50-email test dataset.

## documentation authority

- `BUSINESS.md` for approved product intent and constraints
- `SYSTEM.md` for architecture and integrations
- `docs/agents/master-prompt.md` for orchestration design
- `docs/EMAIL_TRIAGE_TASKS_INDEX.md` for phased task history
- `docs/contracts/` for the email/event schema, intent taxonomy, action set, routing, and escalation contracts
- `docs/01_vision/VISION.md` for durable product direction

## capabilities

- Ingest inbound email and normalize per `docs/contracts/email-schema.md`
- Classify intent (support, sales, contract, technical, billing, spam) via ai-microservice
- Extract entities per `docs/contracts/extractor-contract.md`
- Decide an action per `docs/contracts/action-set.md` and `routing-rules.md`, with bounded escalation
- End-to-end triage pipeline (`POST /api/triage`): ingest -> classify -> extract -> decide -> act
- Web UI over a 50-email test dataset with per-email workflow stepper, run/run-all, and log viewing

## interfaces

- HTTP API: `POST /api/ingest`, `/api/classify`, `/api/extract`, `/api/decide`, `/api/triage`
- HTTP API: `GET /api/emails`, `/api/emails/:id`, `/api/emails/:id/logs`, `PUT /api/emails/:id`, `POST /api/emails/:id/run`, `POST /api/run-all`, `GET/PUT /api/settings`
- Web UI served at root `/` on port 3374 (blue) / 3375 (green)
- Health endpoint: `GET /health`

## development

- Stack: Node.js (Express-style server.js), built-in static web UI, no framework database ORM
- Local run: `npm install && npm start`; requires `AI_SERVICE_URL` and `LOGGING_SERVICE_URL` in `.env`
- Test dataset: `docs/sample_intent_dataset.json` (read-only on disk; editable in-memory via the UI)
- Endpoint tests: `scripts/test-email-triage-endpoints.js` via `AEPS_URL`

## configuration

- Runtime namespace: `statex-apps`; production domain `https://aeps.alfares.cz`
- Ports: 3374 (blue) / 3375 (green), documented in the shared 33xx service-port allocation
- Env vars: `AUTH_SERVICE_URL`, `LOGGING_SERVICE_URL`, `AI_SERVICE_URL`, `NOTIFICATION_SERVICE_URL`, optional `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`
- `nginx-microservice` historically handled blue/green traffic switching per SYSTEM.md (note: nginx-microservice itself was retired ecosystem-wide 2026-06-17; this repo's blue/green ports remain, routing now via Traefik ingress)

## deployment

- Deploy command: `./scripts/deploy.sh`
- Target: Kubernetes `statex-apps` namespace
- Health requirement: `GET /health` responds within the deploy script's 5s timeout
- Deployment remains serialized via the shared ecosystem deploy lock

## health and observability

- Health endpoint: `GET /health`
- Central logging via `logging-microservice` (`LOGGING_SERVICE_URL`); per-email log viewing available in the web UI
- Local logs also written under `LOG_DIR` in addition to the central logging service and in-memory logs (three log locations per `.env.example`)
