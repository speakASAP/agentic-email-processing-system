# Event Schema (Logging and Audit)

Schema for events emitted by agents and sent to the central logging service. Every email and every agent decision must be auditable. Config: `LOGGING_SERVICE_URL` (no hardcoded URLs or secrets).

## Required Fields (Per Event)

| Field | Type | Description |
| ----- | ------ | ------------- |
| `message_id` | string | Links to email schema message_id. |
| `timestamp` | string (ISO 8601) or number (Unix ms) | When the event occurred. |
| `agent` | string | Agent name (e.g. ingest, classifier, extractor, action_decider, escalation). |
| `decision` | string | Decision or outcome (e.g. intent label, action chosen, escalation_triggered). |
| `confidence` | number (0–1) or null | Confidence score when applicable (e.g. classification). Null if not applicable. |
| `escalation_reason` | string or null | If escalation: reason code from escalation contract. Null if no escalation. |
| `tenant_id` | string | From email schema; for filtering and compliance. |
| `intent` | string | Classified intent when agent is classifier or downstream. |
| `action` | string | Action chosen (auto_respond, route_to_queue, escalate) when applicable. |
| `details` | object | Non-secret extra context for diagnosis (e.g. extractor entities summary). |

## Integration

- Events are sent to the central logging service via `LOGGING_SERVICE_URL`.
- API and payload format follow the logging microservice contract (POST /api/logs or equivalent). No modification to logging-microservice code; use published API only.
- All agent decisions and escalations must produce at least one event with message_id, timestamp, agent, decision, confidence, escalation_reason.

## Naming and Versioning

- Schema version: 1.0.
- Agent names and decision values must align with intent taxonomy and action set contracts.
