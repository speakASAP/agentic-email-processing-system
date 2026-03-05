# Action Set

Canonical actions the Action/Decider Agent can choose. Aligned with business-oriented automation (FIVE_APPROACHES §5). No implementation code; contract only.

## Actions

| Action | Description |
| ------ | ------------- |
| auto_respond | System may send an automated response (e.g. acknowledgment, FAQ-based answer). Only when rules and confidence allow; see routing rules. |
| route_to_queue | Route the email to a designated business queue (support, sales, technical, billing, etc.) for human handling. |
| escalate | Escalate to human-in-the-loop; reason and queue determined per escalation contract. |

## Constraints

- Only these three actions. No additional actions without alignment with master-prompt and business scenario.
- Every chosen action must be logged (event schema: agent=action_decider, decision=action name, escalation_reason if action=escalate).

## Mapping to Business Outcomes

- **auto_respond:** Faster resolution, lower load on queues; used only for well-defined, low-risk cases.
- **route_to_queue:** Correct routing to support/sales/technical/billing; SLA and business unit per routing-rules.
- **escalate:** Compliance, brand protection, ambiguous or high-risk cases; full audit trail per escalation contract.

## Config

- Any thresholds or feature flags via `.env` (e.g. `AUTO_RESPOND_ENABLED`); keys only in `.env.example`, no secret values.
