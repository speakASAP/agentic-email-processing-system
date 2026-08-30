# Business: Agentic Email Processing System

> Protected business baseline. Human approval is required before changes to the approved product scope.

```yaml
id: BUSINESS-agentic-email-processing-system
status: approved
owner: project owner
created: 2026-08-30
last_updated: 2026-08-30
completeness_level: validated
upstream:
  - docs/01_vision/VISION.md
  - docs/00_constitution/CONSTITUTION.md
downstream:
  - SYSTEM.md
  - docs/22_goal_impact/GOAL-IMPACT-TASK-001.md
```

## problem

Business operators need inbound email (support, sales, contract, technical, billing, spam) triaged autonomously, with bounded escalation when confidence or policy requires human review, rather than manually reading and routing every message.

## target users and stakeholders

- Business operators reviewing inbound support, sales, contract, technical, billing, and spam triage flows
- Enterprise telecom business context stakeholders (per README.md prototype framing)

## value proposition

The system ingests, classifies, extracts, decides, and routes/acts on inbound email autonomously, reusing the shared ai-microservice for AI execution rather than duplicating LLM orchestration, and escalating only when confidence or policy requires human judgment.

## goals

- Autonomously triage inbound business email: ingest, classify, extract, decide, and route or act
- Escalate with bounded, policy-driven review when confidence or policy requires it
- Reuse ai-microservice for all AI execution rather than duplicating LLM orchestration locally
- Provide a web UI over a 50-email test dataset for verification and demonstration

## non-goals

- Duplicating LLM orchestration logic that already exists in ai-microservice
- Committing secrets or production credentials to this repository
- Using non-synthetic (real customer) email data in docs, tests, logs, or validation artifacts
- Acting outside the documented 33xx service-port allocation or production domain

## success metrics

- Successful end-to-end triage rate across the 50-email test dataset
- Correct intent classification and confidence-based escalation behavior
- Health endpoint availability within the deploy script's timeout

## business constraints

- Reuse `ai-microservice` for AI execution rather than duplicating LLM orchestration locally
- Keep all configuration in environment variables; never commit secrets or production credentials
- Use synthetic examples and datasets in repository docs, tests, logs, and validation artifacts
- Respect the documented 33xx service-port allocation and the production domain `aeps.alfares.cz`

## approval

Status: approved
Approved by: project owner
Approval evidence: owner-confirmation: agentic-email-processing-system-onboarding-approved
