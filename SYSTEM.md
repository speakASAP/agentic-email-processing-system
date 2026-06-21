# System: agentic-email-processing-system

## Architecture

Node.js service with an HTTP API and built-in web UI for the 50-email triage dataset. The runtime exposes ingest, classify, extract, decide, and end-to-end triage endpoints while rendering workflow state and logs for each sample email.

## Integrations

| Service | Usage |
| --- | --- |
| `ai-microservice` | Email-triage AI endpoints via `AI_SERVICE_URL` |
| `logging-microservice` | Central event/log collection via `LOGGING_SERVICE_URL` |
| `auth-microservice` | Optional API and queue auth |
| `notifications-microservice` | Optional notifications |
| `database-server` | Optional PostgreSQL storage when configured |
| `nginx-microservice` | Production blue/green traffic switching |

## Current State

Stage: production

## Known Issues

- [MISSING: authoritative repo-local issue register beyond README troubleshooting notes]
