# Extractor Contract (Phase 2)

Input/output contract for the Extractor Agent. Used by Action/Decider and routing. No implementation here; contract only.

## Input

- **Normalized email payload** (per `email-schema.md`): message_id, tenant_id, subject, body_plain, body_html, attachments (metadata).
- **Optional:** classified intent (from Classifier) for context.

## Output (Structured Data)

| Field | Type | Description |
| ----- | ------ | ------------- |
| message_id | string | From email schema. |
| entities | object | Extracted entities: product_refs, amounts, dates, contract_refs, etc. Shape is implementation-defined; no PII in logs. |
| summary | string (optional) | Short non-secret summary for routing refinement. |

## Constraints

- Extractor MUST NOT log or emit secret or PII in event details; only non-secret context per event-schema.
- Output is used by Action/Decider (routing-rules: extracted_entities optional input).
- Config via `.env` only; no hardcoded URLs/keys.

## Sync B

This contract is agreed at Sync B so Phase 2 Extractor implementation can proceed. Confidence thresholds for classifier are in use (CLASSIFIER_CONFIDENCE_THRESHOLD).
