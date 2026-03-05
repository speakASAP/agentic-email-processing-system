# Email Ingestion Schema

Canonical schema for incoming email payloads processed by the Agentic Email Processing System. Single source of truth for Ingest Agent and downstream agents. Config via `.env` only (e.g. `EMAIL_INGESTION_URL`, `EMAIL_INGESTION_QUEUE`); no hardcoded URLs or secrets.

## Required Fields

| Field | Type | Description |
| ----- | ------ | ------------- |
| `message_id` | string | Unique identifier for the email (e.g. RFC Message-ID or provider id). Must be stable for idempotency and audit. |
| `tenant_id` | string | Tenant or business unit identifier (e.g. brand, region). Used for routing and logging. |
| `timestamp` | string (ISO 8601) or number (Unix ms) | When the message was received or ingested. |

## Content Fields

| Field | Type | Description |
| ----- | ------ | ------------- |
| `sender` | string | Sender email address. |
| `recipients` | string[] | List of recipient addresses. Max 30 per request (align with CREATE_SERVICE). |
| `subject` | string | Email subject line. |
| `body_plain` | string | Plain-text body. Optional if body_html present. |
| `body_html` | string | HTML body. Optional if body_plain present. At least one of body_plain or body_html must be present. |

## Attachments (Metadata Only)

| Field | Type | Description |
| ----- | ------ | ------------- |
| `attachments` | array of `{ id: string, filename: string, content_type: string, size_bytes?: number }` | Attachment metadata only. Content fetched separately if needed (e.g. by Extractor Agent). Max 30 attachments per message for request-size limits. |

## Optional Context

| Field | Type | Description |
| ----- | ------ | ------------- |
| `locale` | string | Preferred language/locale (e.g. de-DE, en). Optional; used for ambiguity and multilingual handling. |
| `metadata` | object | Provider-specific or tenant-specific metadata. Must not contain secrets; use env-based config for secrets. |

## Validation Rules (Ingest Agent)

- `message_id`, `tenant_id`, `timestamp` are required; missing any → reject or escalate per escalation contract.
- At least one of `body_plain` or `body_html` must be present.
- `recipients` and `attachments` length ≤ 30 each (request-size limit).
- Invalid or malformed payloads are logged and handled per escalation contract (e.g. incomplete_data).

## Naming and Versioning

- Schema version: 1.0.
- Naming uses business scenario vocabulary only (support, sales, contract, technical, billing, spam, escalate). No new domain terms without alignment.
