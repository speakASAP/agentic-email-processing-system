# Validation Debt Ledger

## purpose

This ledger records known validation failures that are not caused by the current task so that agents can separate existing debt from real regressions.

## rules

- Validation debt does not excuse current-task failures.
- Every entry requires scope and owner information.
- Keep entries sanitized and avoid secret or private operational data.
- Promote a debt item to blocker status when the failure affects the active task.

## entries

| ID | Date | Command | Failure Summary | Scope | Owner | Blocks Current Task? | Unblock Condition | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| VD-001 | 2026-08-30 | none currently active | No active validation debt recorded for agentic-email-processing-system onboarding | repo-wide | project owner | no | maintain clean adoption evidence | `docs/12_validation/VAL-TASK-001-bootstrap-service.md` |

## update format

Record every validation-debt classification decision using the following reporting format before treating a failure as pre-existing debt rather than a current-task regression.

```text
Validation debt check:
- Command:
- Result:
- Matched ledger entry:
- Current-task impact:
- Next action:
```
