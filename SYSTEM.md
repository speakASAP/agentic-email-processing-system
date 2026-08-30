# System: Agentic Email Processing System

```yaml
id: SYSTEM-agentic-email-processing-system
status: approved
owner: project owner
created: 2026-08-30
last_updated: 2026-08-30
completeness_level: validated
upstream:
  - BUSINESS.md
  - docs/01_vision/VISION.md
downstream:
  - docs/06_architecture/INTEGRATION_CONTRACT.md
  - docs/11_tasks/TASK-001-bootstrap-service.md
```

## purpose

The Agentic Email Processing System is a Node.js service with an HTTP API and built-in web UI that autonomously triages inbound business email (ingest, classify, extract, decide, act) by delegating AI execution to ai-microservice, over a 50-email verification dataset.

## responsibilities

- Expose ingest, classify, extract, decide, and end-to-end triage HTTP endpoints
- Proxy AI-execution calls to ai-microservice via `AI_SERVICE_URL`
- Render workflow state and per-email logs in the built-in web UI
- Emit structured events per `docs/contracts/event-schema.md` for each pipeline step
- Enforce the documented intent taxonomy, action set, routing rules, and escalation policy

## non-responsibilities

- It does not implement its own LLM orchestration, NLP, ASR, or Document AI agents; those live in ai-microservice
- It is not a general-purpose email server or MTA; ingestion is via the documented HTTP contract
- It does not persist workflow state durably by default; DB_HOST/DB_PORT/etc. are optional and unused by current server.js code (in-memory dataset with disk-backed sample dataset)

## inputs

- Inbound email payloads via `POST /api/ingest` or the end-to-end `POST /api/triage`
- The 50-email sample dataset (`docs/sample_intent_dataset.json`)
- Operator edits to sample emails and analysis-mode settings via the web UI

## outputs

- Classified intent, extracted entities, decided action, and escalation reason per email
- Structured events emitted for each pipeline step and the final act outcome
- Structured logs to logging-microservice

## dependencies

- ai-microservice via `AI_SERVICE_URL` for classify/extract/decide AI execution
- logging-microservice via `LOGGING_SERVICE_URL` for centralized event/log collection
- auth-microservice via `AUTH_SERVICE_URL` for optional API/queue authentication
- notifications-microservice via `NOTIFICATION_SERVICE_URL` for optional notifications
- Optional PostgreSQL via `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` (declared in `.env.example` but not referenced in current `server.js`)

## upstream traceability

This system implements the approved intent in `BUSINESS.md` and the product vision in `docs/01_vision/VISION.md`.

## downstream artifacts

- `docs/06_architecture/INTEGRATION_CONTRACT.md`
- `docs/11_tasks/TASK-001-bootstrap-service.md`
- `docs/12_validation/VAL-TASK-001-bootstrap-service.md`
- `docs/21_execution_plans/EP-TASK-001-bootstrap-service.md`

## validation criteria

- `GET /health` responds within the deploy script's 5s timeout
- `scripts/test-email-triage-endpoints.js` (`npm run test:endpoints`) exercises ingest/classify/extract/decide/triage endpoints
- Sync validation docs: `docs/contracts/SYNC_B_VALIDATION.md`, `SYNC_C_VALIDATION.md`, `SYNC_D_VALIDATION.md`
- `docs/OBSERVABILITY_CHECKLIST.md` for logging/observability verification

## open questions

- No authoritative repo-local issue register exists beyond README troubleshooting notes (see SYSTEM.md Known Issues); TASKS.md records this as an owner-decision backlog item (TASK-AEPS-001) rather than an open technical question.
