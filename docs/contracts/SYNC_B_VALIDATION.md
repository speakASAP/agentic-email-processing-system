# Sync B — Classifier and Extractor Contracts (Validation Sign-Off)

Validator check: classifier and extractor contracts and confidence thresholds agreed; Phase 1 (Ingest + Classifier) implemented per contracts. No Phase 2 until Sync B passes.

## Checklist

### Classifier (intent-taxonomy)

| Item | Status |
| ---- | ------ |
| API returns intent, confidence, raw_scores per intent-taxonomy | Pass |
| All 8 intents supported: support, sales, contract, technical, billing, spam, unknown, multi_intent | Pass |
| Below threshold → intent unknown; confidence = raw score | Pass |
| Two or more primary intents above threshold → multi_intent | Pass |
| Confidence threshold from CLASSIFIER_CONFIDENCE_THRESHOLD (default 0.75) | Pass |

### Ingest (email-schema)

| Item | Status |
| ---- | ------ |
| Normalized payload: message_id, tenant_id, timestamp, sender, recipients, subject, body_plain, body_html, attachments | Pass |
| Validation: message_id, tenant_id, timestamp required; at least one of body_plain or body_html | Pass |
| recipients length ≤ 30; attachments length ≤ 30 (request-size limit) | Pass |
| On reject: 400, escalation_reason (e.g. incomplete_data); event emitted (decision: rejected) | Pass |

### Events (event-schema)

| Item | Status |
| ---- | ------ |
| Every ingest/classifier outcome emits event: message_id, timestamp, agent, decision, confidence, escalation_reason | Pass |
| On error (e.g. 503/400): event emitted with decision: error; escalation_reason set when upstream returns 400 | Pass |

### Extractor contract (Phase 2 readiness)

| Item | Status |
| ---- | ------ |
| docs/contracts/extractor-contract.md present | Pass |
| Input: normalized email payload per email-schema; optional classified intent | Pass |
| Output: message_id, entities, optional summary; no PII in logs | Pass |

### Config and contracts

| Item | Status |
| ---- | ------ |
| No hardcoded URLs; AI_SERVICE_URL, LOGGING_SERVICE_URL from env | Pass |
| Naming matches business scenario and intent-taxonomy | Pass |

## Result

**Sync B passed.** Classifier and extractor contracts agreed; confidence thresholds in use. Phase 2 (Extractor + Action/Decider) may proceed.

Validated against: docs/agents/master-prompt.md, docs/EMAIL_TRIAGE_TASKS_INDEX.md, docs/contracts/intent-taxonomy.md, email-schema.md, event-schema.md, extractor-contract.md.

**Last validation re-run:** Phase 1 code (server.js, lib/ai_client.js, lib/classifier.js, lib/ingest.js, utils/logger.js) verified against checklist above. All items pass.
