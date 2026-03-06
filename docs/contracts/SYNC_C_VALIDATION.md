# Sync C — Action/Escalation Rules and Logging Schema (Validation Sign-Off)

Validator check: Action/Decider and Extractor implemented; action set and escalation rules applied; logging schema used for all decisions. No Phase 3 until Sync C passes.

## Checklist

### Extractor (extractor-contract)

| Item | Status |
| ---- | ------ |
| POST /api/extract (app) and /api/email-triage/extract (ai-microservice) | Pass |
| Input: normalized payload; optional intent | Pass |
| Output: message_id, entities, summary?; no PII in logs | Pass |
| Event emitted: agent=extractor, decision=extracted or error | Pass |

### Action/Decider (action-set, routing-rules)

| Item | Status |
| ---- | ------ |
| POST /api/decide (app) and /api/email-triage/decide (ai-microservice) | Pass |
| Input: intent, confidence, optional entities | Pass |
| Output: action (auto_respond | route_to_queue | escalate), escalation_reason?, queue? | Pass |
| unknown/multi_intent → escalate; contract → escalate; below threshold → escalate | Pass |
| route_to_queue with queue by intent (support, sales, technical, billing, spam_review) | Pass |
| Event emitted: agent=action_decider, decision=action, escalation_reason when escalate | Pass |

### Logging and config

| Item | Status |
| ---- | ------ |
| All extract/decide outcomes emit event (event-schema: message_id, agent, decision, escalation_reason) | Pass |
| No hardcoded URLs; AI_SERVICE_URL, LOGGING_SERVICE_URL from env | Pass |
| AUTO_RESPOND_ENABLED from env (decider) | Pass |

## Result

**Sync C passed.** Action/escalation rules and logging schema validated; implementation matches contracts. Phase 3 (Act + Escalate) may proceed.

Validated against: docs/agents/master-prompt.md, docs/contracts/action-set.md, routing-rules.md, escalation-contract.md, event-schema.md, extractor-contract.md.
