# Integration and API (Agentic Email Processing System)

This prototype follows the common approach defined in [CREATE_SERVICE.md](../CREATE_SERVICE.md).

## AI microservice (existing; we extend with our agents)

We use the **existing [ai-microservice](../../ai-microservice/)** — see [ai-microservice/README.md](../../ai-microservice/README.md). It provides:

- **AI Orchestrator** via `AI_SERVICE_URL` — central coordination
- **NLP Service**, ASR, Document AI, Prototype Generator, Template Repository, Free AI, AI Workers, Gemini AI, Data Viz
- Shared database and centralized logging

**Email-triage agents are implemented in ai-microservice** (orchestrator routes `/api/email-triage/ingest`, `/api/email-triage/classify`). This application calls them via `AI_SERVICE_URL` and emits audit events to `LOGGING_SERVICE_URL`. Future agents (extractor, action/decider, escalation) will be added to ai-microservice and used from here the same way.

## Shared microservices

- **Logging:** `LOGGING_SERVICE_URL` — all agent decisions, classifications, and escalations must be sent to the central logging service.
- **Auth:** `AUTH_SERVICE_URL` — use when the system exposes APIs or needs to validate callers.
- **Database:** `DB_*` — use only if the system persists triage state or audit data.
- **AI:** `AI_SERVICE_URL` — points to existing ai-microservice; we extend it with email-triage agents. Optional: `LLM_MODEL_CLASSIFIER`, `LLM_MODEL_EXTRACTOR` if supported.

Do not modify production-ready services (`database-server`, `auth-microservice`, `nginx-microservice`, `logging-microservice`, core ai-microservice agents). Use only their published APIs and scripts; extend ai-microservice with new agents as documented in the master prompt.

## API and contracts

API and event contracts are defined in Phase 0 (see [docs/agents/master-prompt.md](agents/master-prompt.md) and [docs/EMAIL_TRIAGE_TASKS_INDEX.md](EMAIL_TRIAGE_TASKS_INDEX.md)). **Sync A status:** [docs/contracts/SYNC_A_VALIDATION.md](contracts/SYNC_A_VALIDATION.md). **Sync B status:** [docs/contracts/SYNC_B_VALIDATION.md](contracts/SYNC_B_VALIDATION.md). Contract docs:

- Email ingestion schema: [docs/contracts/email-schema.md](contracts/email-schema.md)
- Event/logging schema: [docs/contracts/event-schema.md](contracts/event-schema.md)
- Intent taxonomy: [docs/contracts/intent-taxonomy.md](contracts/intent-taxonomy.md)
- Action set: [docs/contracts/action-set.md](contracts/action-set.md)
- Routing rules: [docs/contracts/routing-rules.md](contracts/routing-rules.md)
- Escalation contract: [docs/contracts/escalation-contract.md](contracts/escalation-contract.md)
- Extractor contract (Sync B): [docs/contracts/extractor-contract.md](contracts/extractor-contract.md)

## Environment and ports

All configuration via `.env`; see `.env.example` for required keys (values only in local `.env`, never committed). This service uses the **33xx shared microservice port range**: default `PORT=3371`, `PORT_GREEN=3372` for blue/green. See [README.md](../README.md#port-and-port-range) for the full port table and service URLs.
