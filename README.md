# Agentic Email Processing System

Prototype of an **Agentic AI Email Triage System** for autonomous processing of inbound business emails in a Deutsche Telekom–oriented context ([telekom.com](https://www.telekom.com)).

## Purpose

- **Understand** incoming messages
- **Classify** intent (support, sales, contract, technical, billing, spam)
- **Extract** relevant information
- **Take appropriate actions** autonomously
- **Escalate** when necessary

## AI foundation

We use the **existing [ai-microservice](../ai-microservice/)** (see [ai-microservice/README.md](../ai-microservice/README.md)) and **extend** it with our email-triage–specific agents. The ai-microservice provides the AI Orchestrator, NLP, ASR, Document AI, and other shared agents; we add agents required for email processing: classifier, extractor, action/decider, escalation evaluator, and any ingest adapter as needed.

## Documentation

- **Master prompt (orchestration):** [docs/agents/master-prompt.md](docs/agents/master-prompt.md)
- **Task index (phases, sync points, agent prompts):** [docs/EMAIL_TRIAGE_TASKS_INDEX.md](docs/EMAIL_TRIAGE_TASKS_INDEX.md)
- **Contracts (Phase 0, Sync A passed):** [docs/contracts/](docs/contracts/) — email/event schema, intent taxonomy, action set, routing, escalation.
- **Integration and API:** [docs/INTEGRATION.md](docs/INTEGRATION.md)
- **Design approaches:** Documented and reasoned for Deutsche Telekom in the master prompt (autonomous workflow, LLM/agent orchestration, reliability and observability, handling ambiguity, business-oriented automation).
- **Service creation:** Follows [CREATE_SERVICE.md](../CREATE_SERVICE.md) (env discipline, logging, no hardcoded values, shared microservices).
- **AI microservice:** [ai-microservice/README.md](../ai-microservice/README.md) — existing agents and integration; we extend with email-triage agents.

## Phase 1+2+3 (Ingest, Classify, Extract, Decide, Act)

All AI agents **live in [ai-microservice](../ai-microservice/)**. This app calls them via `AI_SERVICE_URL` and emits events to `LOGGING_SERVICE_URL`.

- **POST /api/ingest** — Proxies to `POST /api/email-triage/ingest`. Validates and normalizes per [email-schema](docs/contracts/email-schema.md). Returns 400 with `escalation_reason` if invalid.
- **POST /api/classify** — Proxies to `POST /api/email-triage/classify`. Intent and confidence per [intent-taxonomy](docs/contracts/intent-taxonomy.md). Body: `{ "payload": <normalized email> }` or raw fields.
- **POST /api/extract** — Proxies to `POST /api/email-triage/extract`. Entities per [extractor-contract](docs/contracts/extractor-contract.md). Body: `{ "payload": <normalized email>, "intent"?: <string> }`.
- **POST /api/decide** — Proxies to `POST /api/email-triage/decide`. Action per [action-set](docs/contracts/action-set.md) and [routing-rules](docs/contracts/routing-rules.md). Body: `{ "intent", "confidence", "entities"?, "message_id"?, "tenant_id"? }`.
- **POST /api/triage** — End-to-end pipeline: ingest → classify → extract → decide → act. Body: raw email per email-schema. Returns full result (intent, action, escalation_reason, queue) and emits events for each step plus final act outcome.
- Events emitted per [event-schema](docs/contracts/event-schema.md).

**Required:** Set `AI_SERVICE_URL` in `.env`. Run: `npm install && npm start`. Sync B: [SYNC_B_VALIDATION](docs/contracts/SYNC_B_VALIDATION.md). Sync C: [SYNC_C_VALIDATION](docs/contracts/SYNC_C_VALIDATION.md). Sync D: [SYNC_D_VALIDATION](docs/contracts/SYNC_D_VALIDATION.md). Observability: [OBSERVABILITY_CHECKLIST](docs/OBSERVABILITY_CHECKLIST.md).

## Demo (50-email dataset)

A **visual demo** runs the full pipeline on a fixed dataset of 50 test emails and shows per-email workflow state.

- **Start:** `npm install && npm start` (ensure `AI_SERVICE_URL` and `LOGGING_SERVICE_URL` are set in `.env`).
- **Local:** Open [http://localhost:3374/](http://localhost:3374/) (root; use your configured `PORT`).
- **Production:** Frontend only at **https://aeps.alfares.cz** (served at root `/`). No other frontend URLs.
- **List view:** All 50 emails with subject, preview, status (pending / running / completed / failed), final category and action. Filter by status or category.
- **Detail view:** Click an email to see a **stepper** (Ingest → Classify → Extract → Decide) with status and key inputs/outputs per stage; use **Run triage** to process that email.
- **Run all:** Use **Run all 50 emails** to process the full dataset (one email at a time in the background). The list and detail views update via short polling (~1.5 s). **Polling** shows “Polling…” only while at least one email is in progress; it stops automatically when no emails are running (completed or failed) or when a poll request fails (e.g. network error), so the status text is cleared.
- **Edit:** Use **Edit** (next to Run all 50 emails) to change any sample email for real-time testing: select an email from the list, edit subject, sender, and body, then Save. Edits are in-memory only; stages reset to pending so you can run triage on the updated content.
- **Dataset:** Single source of truth is `docs/sample_intent_dataset.json` (read-only on disk; in-memory copies can be edited via the UI). To reset demo state, restart the service.

### Frontend URL (single canonical)

| Context | URL |
| --------| -----|
| **Production** | **https://aeps.alfares.cz** (frontend only; nothing else) |
| Local | `http://localhost:3374/` |
| Health | `http://localhost:3374/health` (local) or via backend |
| API (backend) | `GET /api/demo/emails`, `GET /api/demo/emails/:id`, `PUT /api/demo/emails/:id` (edit), `POST /api/demo/emails/:id/run`, `POST /api/demo/run-all` |

**After deployment:** Run `./scripts/deploy.sh`; when the aeps.alfares.cz certificate is present (or symlinked from wildcard), **https://aeps.alfares.cz** is installed and available — it is the only frontend URL. The long domain `agentic-email-processing-system.alfares.cz` redirects to it. No `/demo` or `/demo/` paths; the app is served at root `/`.

## Port and port range

Ports use the **33xx shared microservice range**, aligned with root [README.md](../README.md) (3371–3373 = auth-microservice; 3380+ = ai-microservice). This service uses **3374 (blue)** and **3375 (green)** to avoid conflict:

| Port  | Service |
| ----- | ------- |
| 3367  | logging-microservice |
| 3368  | notifications-microservice (blue) |
| 3369  | notifications-microservice (green) |
| 3370–3373 | auth-microservice (backend + frontend blue/green) |
| **3374** | **agentic-email-processing-system (blue)** |
| **3375** | **agentic-email-processing-system (green)** |
| 3380+ | ai-microservice |

Configure via `.env`: `PORT=3374`, `PORT_BLUE=3374`, `PORT_GREEN=3375`. The app listens on `PORT` (default 3374). Do not use ports outside the allowed range.

## Environment and services

All configuration is via `.env`; keys (no secret values) are in `.env.example`. Variable names match other services in the ecosystem (e.g. notifications-microservice) where applicable.

| Variable | Description | Example (Docker network) |
| -------- | ----------- | ------------------------- |
| `PORT` | Application port (33xx range) | `3374` |
| `PORT_BLUE` / `PORT_GREEN` | Blue/green deployment ports | `3374` / `3375` |
| `DOMAIN` | Service domain for nginx auto-registry | `agentic-email-processing-system.alfares.cz` |
| `SERVICE_NAME` | Logging and auth registration | `agentic-email-processing-system` |
| `NGINX_NETWORK_NAME` | Docker network for blue/green | `nginx-network` |
| `LOGGING_SERVICE_URL` | Central logging (required) | `http://logging-microservice:3367` |
| `AUTH_SERVICE_URL` | Auth for API/queues (optional) | `http://auth-microservice:3370` |
| `AI_SERVICE_URL` | ai-microservice (email-triage agents) | `http://ai-microservice:3380` |
| `NOTIFICATION_SERVICE_URL` | Notifications (optional) | `http://notifications-microservice:3368` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Shared PostgreSQL (optional) | `db-server-postgres`, `5432`, … |
| `CLASSIFIER_CONFIDENCE_THRESHOLD` | Intent threshold (default 0.75) | `0.75` |
| `AUTO_RESPOND_ENABLED` | Feature flag for auto-respond | `true` / `false` |

Production URLs (e.g. `https://ai.alfares.cz`, `https://logging.alfares.cz`) are set on the server; local `.env` uses Docker network hostnames and the ports above.

## Deployment

Configuration and deployment follow the common approach (see [CREATE_SERVICE.md](../CREATE_SERVICE.md)): `.env` as single source of truth, integration with shared microservices, blue/green via nginx-microservice.

**Nginx config (codebase only; same blue/green approach as other microservices):**
- `nginx/nginx-api-routes.conf` — List of routes (`/`, `/api/*`, `/health`) consumed by nginx-microservice’s deploy-smart.sh to update the service registry. Required; not an nginx server config.
- `nginx/aeps.alfares.cz.blue.conf` and `nginx/aeps.alfares.cz.green.conf` — One config per color (same approach as other microservices): redirect long domain to **https://aeps.alfares.cz** and proxy to the active container. Deploy script copies the one matching the main-domain symlink so aeps works whether traffic is on blue or green.

### Production (Docker + blue/green)

- **Build:** `docker compose build` or `docker build -t agentic-email-processing-system .`
- **Run locally (single container):** `docker compose up -d` (requires `nginx-network` and `.env`).
- **Deploy to production (alfares.cz):** On the **production server** (e.g. `ssh statex`), from this repo after `git pull`, run:

  ```bash
  ./scripts/deploy.sh
  ```

  This calls `nginx-microservice/scripts/blue-green/deploy-smart.sh agentic-email-processing-system`, which builds the image, runs health checks, and switches traffic. The script then installs **https://aeps.alfares.cz** by copying the aeps config that matches the active color (blue or green), so the frontend works regardless of which slot is active. No manual nginx edits on prod. Deploy must be run where shared services (`LOGGING_SERVICE_URL`, `AI_SERVICE_URL`) are reachable on the same Docker network.

**First-time setup on production:** Ensure the service is registered in nginx-microservice (e.g. run `./scripts/add-service-registry.sh agentic-email-processing-system` from the nginx-microservice directory and set domain, production path, container name base `agentic-email-processing-system`, container port `3374`, health endpoint `/health`). Then run `./scripts/deploy.sh` from this repo. For **aeps.alfares.cz** HTTPS, the deploy script creates a symlink `certificates/aeps.alfares.cz` → `alfares.cz` when a wildcard cert exists; otherwise ensure a certificate for `aeps.alfares.cz` is present in nginx-microservice's `certificates/`.
