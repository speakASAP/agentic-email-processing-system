# Business: agentic-email-processing-system

## Goal

Autonomously triage inbound business email: ingest, classify, extract, decide, and route or act with bounded escalation when confidence or policy requires it.

## Constraints

- Reuse `ai-microservice` for AI execution rather than duplicating LLM orchestration locally.
- Keep all configuration in environment variables; never commit secrets or production credentials.
- Use synthetic examples and datasets in repository docs, tests, logs, and validation artifacts.
- Respect the documented 33xx service-port allocation and the production domain `aeps.alfares.cz`.

## Consumers

Business operators reviewing inbound support, sales, contract, technical, billing, and spam triage flows.

## SLA

- Local HTTP: `http://localhost:3374/`
- Local health: `http://localhost:3374/health`
- Production URL: `https://aeps.alfares.cz`
