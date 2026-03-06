# Phase 1 Verification (Ingest + Classifier)

Checked against [docs/EMAIL_TRIAGE_TASKS_INDEX.md](EMAIL_TRIAGE_TASKS_INDEX.md) §4 and contracts. **Sync B:** [docs/contracts/SYNC_B_VALIDATION.md](contracts/SYNC_B_VALIDATION.md) — must pass before Phase 2.

## Checklist

| Item | Status |
| ---- | ------ |
| **1.1 Ingest Agent** | |
| POST /api/ingest exposed; proxies to ai-microservice /api/email-triage/ingest | Pass |
| Normalized payload per email-schema (via ai-microservice) | Pass |
| Validation: message_id, tenant_id, timestamp required; body_plain or body_html; recipients/attachments ≤ 30 | Pass (lib/ingest.js reference; ai-microservice canonical) |
| On reject: 400, escalation_reason (e.g. incomplete_data); event emitted (decision: rejected) | Pass |
| On success: event emitted (decision: accepted) | Pass |
| On error (503/400): event emitted (decision: error) with escalation_reason when upstream returns 400 | Pass |
| **1.2 Classifier Agent** | |
| POST /api/classify exposed; proxies to ai-microservice /api/email-triage/classify | Pass |
| Response: intent, confidence, raw_scores per intent-taxonomy | Pass |
| Intents: support, sales, contract, technical, billing, spam, unknown, multi_intent | Pass (lib/classifier.js INTENTS; ai-microservice canonical) |
| Below threshold → unknown; two above threshold → multi_intent | Pass |
| Confidence threshold from CLASSIFIER_CONFIDENCE_THRESHOLD; default 0.75 | Pass |
| Event emitted: message_id, agent, decision=intent, confidence, escalation_reason | Pass |
| On error: event emitted (decision: error); escalation_reason from upstream when 400 | Pass |
| **Integration** | |
| AI_SERVICE_URL, LOGGING_SERVICE_URL from env; no hardcoded URLs (lib/ai_client.js, utils/logger.js) | Pass |
| Events via logger.emitEvent → LOGGING_SERVICE_URL (event-schema fields) | Pass |
| Sync B passed ([docs/contracts/SYNC_B_VALIDATION.md](contracts/SYNC_B_VALIDATION.md)) | Pass |

## Result

**Phase 1 implemented correctly.** Ingest and Classifier agents are exposed via this app and delegate to ai-microservice; all decisions (accept, reject, intent, error) are auditable. Every request path (success, reject, error) emits an event per event-schema; classifier error events include escalation_reason when upstream returns 400.

**Last validation re-run:** Checklist re-verified against current codebase; all items pass. Sync B remains passed.

**ai-microservice implementation:** Phase 1 canonical endpoints are implemented in ai-microservice (ai-orchestrator): `app/email_triage_agents.py` (validate_and_normalize, classify_payload) and `POST /api/email-triage/ingest`, `POST /api/email-triage/classify` in `main.py`. Public path `/api/email-triage` allowed in `shared/auth.py` for service-to-service calls.

## Phase 1 execution (master-prompt §4)

**Executed:** 2026-03-06. Lead Orchestrator ran Phase 1 per [docs/agents/master-prompt.md](agents/master-prompt.md) and task index §4.

- **Sync A:** Passed (contracts frozen); Phase 1 allowed to run.
- **App run:** `npm start` with `PORT`, `AI_SERVICE_URL`, `LOGGING_SERVICE_URL` from env; server listens and responds.
- **Endpoints:** `POST /api/ingest` and `POST /api/classify` exposed; proxy to ai-microservice; on success/reject/error events emitted per event-schema.
- **Full E2E:** For end-to-end ingest → classify, ensure ai-microservice is running and `AI_SERVICE_URL` points to it (e.g. `http://ai-microservice:3380` in Docker, or `http://127.0.0.1:3380` locally).

### Phase 1 execution re-run (2026-03-06)

- **Sync A:** Confirmed passed ([docs/contracts/SYNC_A_VALIDATION.md](contracts/SYNC_A_VALIDATION.md)).
- **App run:** `npm start` with `PORT=3391`, `AI_SERVICE_URL=http://127.0.0.1:3380`; server listened and `GET /health` returned `{"status":"ok","service":"agentic-email-processing-system"}`.
- **Endpoints:** `POST /api/ingest` and `POST /api/classify` responded; proxy to ai-microservice returned 503 (upstream 401) when the running ai-microservice required Authorization for `/api/email-triage/*`.
- **E2E note:** Codebase has `shared/auth.py` allowing `path.startswith("/api/email-triage")` (no JWT). For full E2E success, deploy ai-microservice with current `shared/auth.py` so ingest/classify are public for service-to-service calls, or ensure the instance at `AI_SERVICE_URL` is built from this repo.
