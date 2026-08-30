# Integration Contract: Agentic Email Processing System

```yaml
id: INTEGRATION-CONTRACT-agentic-email-processing-system
status: approved
owner: project owner
created: 2026-08-30
last_updated: 2026-08-30
completeness_level: validated
upstream:
  - SYSTEM.md
  - BUSINESS.md
downstream:
  - docs/11_tasks/TASK-001-bootstrap-service.md
  - docs/12_validation/VAL-TASK-001-bootstrap-service.md
```

## purpose

This contract records the ecosystem dependencies required for the Agentic Email Processing System to triage inbound email correctly, and the fallback behavior when a dependency degrades.

## capability decisions

| Capability | Component | Decision | Reason |
|---|---|---|---|
| auth | auth-microservice | required | SYSTEM.md documents auth-microservice as providing optional API and queue authentication, configured via `AUTH_SERVICE_URL` in .env.example. |
| postgres | database-server (db-server-postgres) | not-applicable | `.env.example` declares optional DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME variables, but no code in server.js references them; the service currently runs entirely on the in-memory/disk-backed sample dataset without a mandatory PostgreSQL dependency. |
| redis | database-server (db-server-redis) | not-applicable | No Redis client, environment variable, or documented usage exists anywhere in this repository. |
| logging | logging-microservice | required | SYSTEM.md and .env.example document LOGGING_SERVICE_URL as the central event/log collection endpoint used for every pipeline step and the web UI's per-email log viewer. |
| notifications | notifications-microservice | required | SYSTEM.md documents notifications-microservice as an optional integration via NOTIFICATION_SERVICE_URL in .env.example for triage-related notifications. |
| ai | ai-microservice | required | This is the core dependency: classify/extract/decide proxy directly to ai-microservice via AI_SERVICE_URL, per README.md and BUSINESS.md's explicit reuse constraint. |
| payments | payments-microservice | not-applicable | This service triages email; it has no payment processing concern. |
| catalog | catalog-microservice | not-applicable | No catalog/product-domain concern exists in this email-triage service. |
| orders | orders-microservice | not-applicable | No order-processing concern exists in this email-triage service. |
| warehouse | warehouse-microservice | not-applicable | No physical inventory concern exists in this email-triage service. |
| invoices | invoices-microservice | not-applicable | No invoicing concern exists in this email-triage service. |
| object-storage | minio-microservice | not-applicable | No object-storage usage was found in this repository; email attachments/content are not persisted to MinIO in the current implementation. |
| event-bus | RabbitMQ | not-applicable | The `.env.example` declares an EMAIL_INGESTION_QUEUE variable, but no RabbitMQ/AMQP client code exists in server.js; ingestion is via direct HTTP POST, not the shared event bus. |
| docs-rag | docs-rag-microservice | required | AGENTS.md already directs agents to use docs-rag-microservice for bounded discovery on this repository, with Git as the authoritative fallback. |
| monitoring | monitoring-microservice | required | Runtime health and rollout readiness must be observable through the shared monitoring model, consistent with the documented `GET /health` deploy-script check. |
| backups | backups-microservice | not-applicable | The service holds no durable database (PostgreSQL usage is optional and currently unused); the sample dataset is a versioned repository file, not a production data store requiring backup. |

## data ownership

This service owns in-memory/session workflow state for the sample dataset; it does not own durable domain data. AI classification/extraction results are computed by ai-microservice and passed through, not independently owned.

## authentication and authorization

- API/queue authentication via auth-microservice is optional per SYSTEM.md and must not be silently bypassed when configured.

## synchronous dependencies

- Classify/extract/decide proxy calls to ai-microservice via AI_SERVICE_URL
- Structured event/log delivery to logging-microservice via LOGGING_SERVICE_URL

## asynchronous dependencies

- Optional notification dispatch to notifications-microservice via NOTIFICATION_SERVICE_URL

## degraded operation

When ai-microservice is unavailable, classify/extract/decide fall back to rule-based logic and the response reports `model_used: rule-based` rather than silently claiming an LLM result; logging/notification outages degrade observability without blocking the core triage pipeline.

## validation

- `GET /health` responds within the deploy script's 5s timeout
- `npm run test:endpoints` exercises ingest/classify/extract/decide/triage
- Sync B/C/D validation docs confirm each pipeline stage's contract compliance
