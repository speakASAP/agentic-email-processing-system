# Business: agentic-email-processing-system
>
> ⚠️ IMMUTABLE BY AI.

## Goal

Autonomous AI email triage: classify inbound emails by intent, extract information, auto-respond or escalate to human.

## Constraints

- AI must never send email replies without human approval on first run per template
- Emails with financial/legal content must always escalate to human
- Email credentials managed in .env only

## Consumers

statex, business-orchestrator (email signals → task triggers).

## SLA

- Port: 3374/3375 (blue/green)
- Endpoints: POST /api/ingest, POST /api/classify
