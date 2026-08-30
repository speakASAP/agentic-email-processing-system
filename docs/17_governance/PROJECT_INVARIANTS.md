# Project Invariants: Agentic Email Processing System

```yaml
id: PROJECT-INVARIANTS-agentic-email-processing-system
status: approved
owner: project owner
created: 2026-08-30
last_updated: 2026-08-30
completeness_level: validated
upstream:
  - BUSINESS.md
  - SYSTEM.md
  - docs/01_vision/VISION.md
downstream:
  - docs/01_vision/VISION.md
  - docs/12_validation/VAL-TASK-001-bootstrap-service.md
```

## purpose

These invariants protect the Agentic Email Processing System's intent: ai-microservice-delegated triage with bounded escalation and synthetic-only data.

## applicability

These invariants apply to all triage pipeline logic, AI-delegation code, and any test/validation data added to this repository.

## invariants

- AEPS-INV-001: AI execution for classify/extract/decide must be delegated to ai-microservice via AI_SERVICE_URL, not duplicated locally.
- AEPS-INV-002: Only synthetic email examples and datasets may appear in repository docs, tests, logs, and validation artifacts.
- AEPS-INV-003: Escalation must be triggered by genuine confidence/policy thresholds, never fabricated or bypassed.
- AEPS-INV-004: Secrets and production credentials must never be committed; all configuration lives in environment variables.
- AEPS-INV-005: The service must respect the documented 33xx port allocation (3374 blue / 3375 green) and the production domain aeps.alfares.cz.

## exceptions

Exceptions to these invariants require explicit owner approval and must be documented in the affected task or validation record.

## review cadence

Review project invariants when entering a materially new scope, a deployment readiness gate, or a workflow change that affects operator trust or production safety.
