# Agents: Agentic Email Processing System

## required reading

Before implementation, read:

- `README.md`
- `BUSINESS.md`
- `SYSTEM.md`
- `AGENTS.md`
- `AGENT_OPERATIONS.md`
- `TASKS.md`
- `STATE.json`
- `docs/17_governance/PROJECT_INVARIANTS.md`
- `docs/01_vision/VISION.md`

## authority

Operators and agent workers may act only within the approved project intent, scope boundaries, and validation gates in this repository. Human approval is required for scope changes or production deployment decisions.

## intent preservation system

The project preserves the chain:

`Vision -> Goal Impact -> System -> Feature -> Task -> Execution Plan -> Coding Prompt -> Code -> Validation`

This is the binding requirement for planning, coding, and validation work.

## safety and operations

- Never commit secrets, credentials, or raw production data
- Keep the system grounded in proven repository facts
- Use `[MISSING: ...]` or `[UNKNOWN: ...]` instead of inventing facts
- Keep validation debt separate from current-task failures
- Prefer the narrowest valid validation command before broad test suites

## project-specific rules

- Classification and decision logic must call ai-microservice (`AI_SERVICE_URL`) rather than duplicating LLM orchestration locally
- Use only synthetic examples and datasets in docs, tests, logs, and validation artifacts — never real customer email content
- Respect the documented 33xx port allocation (3374 blue / 3375 green) and the production domain `aeps.alfares.cz`
- TASK-AEPS-001 in TASKS.md requires an explicit owner decision on the next implementation lane before an agent invents priorities for AI connectivity, endpoint verification, or triage-behavior work

## required final report

The final task report must include:

- files changed
- documents created or revised
- validation commands and results
- validation debt used or created
- active blockers as `[MISSING: ...]` or `[UNKNOWN: ...]`
- deviations from scope
- next concrete action
