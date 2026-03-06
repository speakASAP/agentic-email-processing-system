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

## Phase 1 (Ingest + Classifier)

All AI agents (ingest, classifier, and future extractor, action/decider, escalation) **live in [ai-microservice](../ai-microservice/)**. This app calls them via `AI_SERVICE_URL`.

- **POST /api/ingest** — Proxies to ai-microservice `POST /api/email-triage/ingest`. Validates and normalizes payload per [docs/contracts/email-schema.md](docs/contracts/email-schema.md). Returns 400 with `escalation_reason` if invalid.
- **POST /api/classify** — Proxies to ai-microservice `POST /api/email-triage/classify`. Returns intent and confidence per [docs/contracts/intent-taxonomy.md](docs/contracts/intent-taxonomy.md). Body: `{ "payload": <normalized email> }` or raw email fields.
- Events emitted to `LOGGING_SERVICE_URL` per [docs/contracts/event-schema.md](docs/contracts/event-schema.md).

**Required:** Set `AI_SERVICE_URL` in `.env`. Run: `npm install && npm start`. Sync B: [docs/contracts/SYNC_B_VALIDATION.md](docs/contracts/SYNC_B_VALIDATION.md).

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

All configuration is via `.env`; keys (no secret values) are in `.env.example`. Variable names match statex, shop-assistant, and notifications-microservice where applicable.

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

Configuration and deployment follow the common approach: `.env` as single source of truth, integration with shared microservices (auth, database, logging, etc.), blue/green pattern via nginx-microservice where applicable.
