# Observability Checklist (Phase 3 / Sync D)

Operational runbook for the Agentic Email Processing System. Aligned with FIVE_APPROACHES §3 (Reliability and Observability) and event-schema.

## Logging

| Item | Status / Notes |
| ---- | ----------------- |
| All agent decisions emitted as events | Every step (ingest, classifier, extractor, action_decider, act) emits an event per [event-schema](contracts/event-schema.md). |
| Events sent to central logging | `LOGGING_SERVICE_URL`; see `utils/logger.js` and `emitEvent`. |
| Required fields per event | message_id, timestamp, agent, decision, confidence (when applicable), escalation_reason (when escalate). |
| Errors and rejections logged | Ingest reject, classifier/extract/decide errors emit event with decision=error and escalation_reason when applicable. |

## Metrics (Conceptual)

- **Latency:** Time per step and end-to-end for `POST /api/triage` (implement via logging or APM in deployment).
- **Classification distribution:** Counts per intent (support, sales, contract, technical, billing, spam, unknown, multi_intent); derive from logs.
- **Escalation rate:** Count of events with action=escalate or escalation_reason set; derive from logs.
- **Error rate:** Count of events with decision=error per agent.

## Alerts (Runbook)

- Spike in decision=error for any agent.
- Escalation rate above a threshold (configurable).
- Upstream AI_SERVICE_URL or LOGGING_SERVICE_URL unavailable (503 / logging failures).

## End-to-end flow

- **Single entry:** `POST /api/triage` runs ingest → classify → extract → decide → act.
- **Act outcome:** Final event with agent=act, decision=action (auto_respond | route_to_queue | escalate); escalation_reason and queue when applicable.
- **Cutover:** See [EMAIL_TRIAGE_TASKS_INDEX.md](EMAIL_TRIAGE_TASKS_INDEX.md) §7 Validation Checklist for Cutover.

## Document references

- Event schema: [docs/contracts/event-schema.md](contracts/event-schema.md)
- Sync D: [docs/contracts/SYNC_D_VALIDATION.md](contracts/SYNC_D_VALIDATION.md)
