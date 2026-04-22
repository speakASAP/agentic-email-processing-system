# CLAUDE.md (agentic-email-processing-system)

Ecosystem defaults: sibling [`../CLAUDE.md`](../CLAUDE.md) and [`../shared/docs/PROJECT_AGENT_DOCS_STANDARD.md`](../shared/docs/PROJECT_AGENT_DOCS_STANDARD.md).

Read this repo's `BUSINESS.md` → `SYSTEM.md` → `AGENTS.md` → `TASKS.md` → `STATE.json` first.

---

## agentic-email-processing-system

**Purpose**: Autonomous AI email triage — classify inbound emails by intent, extract information, auto-respond or escalate to human.  
**Ports**: 3374 (blue) · 3375 (green)  
**Stack**: NestJS · PostgreSQL · RabbitMQ · ai-microservice

### Key constraints

- Never send email replies without human approval on first run per template
- Emails with financial or legal content must always escalate to human — no auto-reply
- Email credentials in `.env` only — never log them

### Key endpoints

- `POST /api/ingest` — receive raw email
- `POST /api/classify` — classify intent

### Events

- Classified events → RabbitMQ → business-orchestrator (email signals → task triggers)

### Quick ops

```bash
curl http://localhost:3374/health
docker compose logs -f
./scripts/deploy.sh
```
