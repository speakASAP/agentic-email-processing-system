# Observability Checklist

Checklist for logging, audit, and operations of the Agentic Email Processing System. Aligns with [event-schema](contracts/event-schema.md), [FIVE_APPROACHES_DEUTSCHE_TELEKOM.md](FIVE_APPROACHES_DEUTSCHE_TELEKOM.md) (Reliability and Observability), and Sync D cutover.

## 1. Central Logging

| Item | Status |
| ---- | ------ |
| `LOGGING_SERVICE_URL` used; no hardcoded logging URLs | Required |
| `utils/logger.js` used for all agent events and errors | Required |
| Keys only in `.env.example`; values in `.env` | Required |

## 2. Event Schema (Per Agent Decision)

Every agent outcome must emit at least one event with:

| Field | Required | Notes |
| ----- | -------- | ----- |
| `message_id` | Yes | Links to email |
| `timestamp` | Yes | ISO 8601 or Unix ms |
| `agent` | Yes | ingest, classifier, extractor, action_decider, act |
| `decision` | Yes | accepted/rejected, intent, action, error |
| `confidence` | When applicable | 0–1 or null |
| `escalation_reason` | When applicable | From escalation contract or null |
| `tenant_id` | Yes | From email |
| `intent` | When applicable | From classifier or downstream |
| `action` | When applicable | From decide/act |
| `details` | Optional | Non-secret context for diagnosis |

## 3. Pipeline Steps — What Gets Logged

| Step | Event agent | When | Key fields |
| ---- | ----------- | ---- | ---------- |
| Ingest | ingest | Accept / Reject / Error | decision, escalation_reason on reject/error |
| Classify | classifier | Success / Error | intent, confidence, raw_scores in details |
| Extract | extractor | Success / Error | entities in details |
| Decide | action_decider | Success / Error | intent, action, escalation_reason, queue |
| Act | act | Final outcome | action, escalation_reason, queue |

## 4. Error and Escalation Logging

| Item | Status |
| ---- | ------ |
| Ingest reject (400): event with decision=rejected, escalation_reason | Required |
| Classify/Extract/Decide errors: event with decision=error, details.error | Required |
| All escalation reasons auditable (logged with message_id) | Required |
| No secrets or PII in event details (only IDs, codes, summaries) | Required |

## 5. Demo and Debug

| Item | Status |
| ---- | ------ |
| Demo UI "See logs…" uses `GET /api/demo/emails/:message_id/logs` | Implemented |
| Backend filters central logging by message_id for that endpoint | Implemented |
| Failed stages visible in frontend (status failed, error message) | Implemented |

## 6. Operations (Outside Repo)

Runbooks, alerting, and dashboard setup are ops responsibility; this checklist ensures the application emits the data needed for them.
