# Escalation Contract

Escalation reasons and mapping to human queues. Safe default: when in doubt, escalate. Every escalation is auditable via event schema (escalation_reason). Aligned with FIVE_APPROACHES §3 (reliability) and §4 (ambiguity).

## Escalation Reason Taxonomy

| Reason code | Description |
| ----------- | ------------- |
| ambiguous_intent | Intent unknown or unclear (classifier returned unknown). |
| multi_intent | Message has multiple intents; cannot assign single queue. |
| low_confidence | Classification confidence below threshold. |
| incomplete_data | Missing required fields (e.g. body, message_id) or malformed payload. |
| policy_sensitive | Content may touch legal, compliance, or brand policy; human review required. |
| complaint | Customer complaint or negative sentiment; human handling. |
| contract_change | Contract-related request; human-in-the-loop per business rule. |
| billing_dispute | Billing dispute or refund request; human handling. |
| other | Catch-all when no other code fits; must be logged with short free-text reason in details. |

## Queue Mapping (Conceptual)

- Each reason code can map to a human queue or handoff channel (e.g. support_escalation, legal, compliance). Exact queue names and IDs are configurable via env or tenant config; no hardcoded values in this contract.
- contract_change, policy_sensitive, complaint → typically legal or compliance queue.
- ambiguous_intent, multi_intent, low_confidence, incomplete_data → support or triage queue.

## Audit Trail

- Every escalation MUST emit an event (event schema) with: message_id, timestamp, agent (e.g. action_decider or escalation), decision=escalate, escalation_reason=<reason code>. Optional: details with short explanation.
- Logs sent to central logging via `LOGGING_SERVICE_URL`. No modification to logging-microservice; use published API only.

## Mandatory Escalation (No Bypass)

- unknown / multi_intent / below-confidence classification → must escalate; no “temporary” auto_respond or route without business approval.
- contract_change, complaint, policy_sensitive → must escalate; no bypass.

## Naming

- Vocabulary: escalation_reason codes above; support, sales, contract, technical, billing, spam, escalate. No new domain terms without alignment.
