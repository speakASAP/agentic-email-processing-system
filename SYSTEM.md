# System: agentic-email-processing-system

## Architecture

NestJS + AI agents + PostgreSQL. Blue/green 3374/3375.

- POST /api/ingest — receive raw email
- POST /api/classify — classify intent
- AI classification via ai-microservice
- Emits classified events to RabbitMQ

## Integrations

| Service | Usage |
|---------|-------|
| database-server:5432 | PostgreSQL |
| logging-microservice:3367 | Logs |
| ai-microservice:3380 | Email classification LLM |

## Current State
<!-- AI-maintained -->
Stage: production

## Known Issues
<!-- AI-maintained -->
- None
