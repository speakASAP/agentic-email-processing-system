# Agentic Email Processing System

Prototype of an **Agentic AI Email Triage System** for autonomous processing of inbound business emails in an enterprise telecom business context.

## Purpose

- **Understand** incoming messages
- **Classify** intent (support, sales, contract, technical, billing, spam)
- **Extract** relevant information
- **Take appropriate actions** autonomously
- **Escalate** when necessary

## AI foundation

We use the **existing [ai-microservice](../ai-microservice/)** (see [ai-microservice/README.md](../ai-microservice/README.md)) and **extend** it with our email-triage–specific agents. The ai-microservice provides the AI Orchestrator, NLP, ASR, Document AI, and other shared agents; we add agents required for email processing: classifier, extractor, action/decider, escalation evaluator, and any ingest adapter as needed.

## Documentation

- **Master prompt (orchestration):** [docs/agents/master-prompt.md](docs/agents/master-prompt.md)
- **Task index (phases, sync points, agent prompts):** [docs/EMAIL_TRIAGE_TASKS_INDEX.md](docs/EMAIL_TRIAGE_TASKS_INDEX.md)
- **Contracts (Phase 0, Sync A passed):** [docs/contracts/](docs/contracts/) — email/event schema, intent taxonomy, action set, routing, escalation.
- **Integration and API:** [docs/INTEGRATION.md](docs/INTEGRATION.md)
- **Design approaches:** Documented and reasoned in the master prompt (autonomous workflow, LLM/agent orchestration, reliability and observability, handling ambiguity, business-oriented automation).
- **Service creation:** Follows [CREATE_SERVICE.md](../CREATE_SERVICE.md) (env discipline, logging, no hardcoded values, shared microservices).
- **AI microservice:** [ai-microservice/README.md](../ai-microservice/README.md) — existing agents and integration; we extend with email-triage agents.

## Phase 1+2+3 (Ingest, Classify, Extract, Decide, Act)

All AI agents **live in [ai-microservice](../ai-microservice/)**. This app calls them via `AI_SERVICE_URL` and emits events to `LOGGING_SERVICE_URL`.

- **POST /api/ingest** — Proxies to `POST /api/email-triage/ingest`. Validates and normalizes per [email-schema](docs/contracts/email-schema.md). Returns 400 with `escalation_reason` if invalid.
- **POST /api/classify** — Proxies to `POST /api/email-triage/classify`. Intent and confidence per [intent-taxonomy](docs/contracts/intent-taxonomy.md). Body: `{ "payload": <normalized email> }` or raw fields.
- **POST /api/extract** — Proxies to `POST /api/email-triage/extract`. Entities per [extractor-contract](docs/contracts/extractor-contract.md). Body: `{ "payload": <normalized email>, "intent"?: <string> }`.
- **POST /api/decide** — Proxies to `POST /api/email-triage/decide`. Action per [action-set](docs/contracts/action-set.md) and [routing-rules](docs/contracts/routing-rules.md). Body: `{ "intent", "confidence", "entities"?, "message_id"?, "tenant_id"? }`.
- **POST /api/triage** — End-to-end pipeline: ingest → classify → extract → decide → act. Body: raw email per email-schema. Returns full result (intent, action, escalation_reason, queue) and emits events for each step plus final act outcome.
- Events emitted per [event-schema](docs/contracts/event-schema.md).

**Required:** Set `AI_SERVICE_URL` in `.env`. Run: `npm install && npm start`. Sync B: [SYNC_B_VALIDATION](docs/contracts/SYNC_B_VALIDATION.md). Sync C: [SYNC_C_VALIDATION](docs/contracts/SYNC_C_VALIDATION.md). Sync D: [SYNC_D_VALIDATION](docs/contracts/SYNC_D_VALIDATION.md). Observability: [OBSERVABILITY_CHECKLIST](docs/OBSERVABILITY_CHECKLIST.md).

## Test dataset (50 emails) and Web UI

A **test dataset** of 50 emails is used to verify the full pipeline. The Web UI lists these emails and shows per-email workflow state.

- **Start:** `npm install && npm start` (ensure `AI_SERVICE_URL` and `LOGGING_SERVICE_URL` are set in `.env`).
- **Local:** Open [http://localhost:3374/](http://localhost:3374/) (root; use your configured `PORT`).
- **Production:** Frontend at **<https://aeps.alfares.cz>** (served at root `/`).
- **List view:** All 50 emails with subject, preview, status (pending / running / completed / failed), final category and action. Filter by status or category.
- **Detail view:** Click an email to see a **stepper** (Ingest → Classify → Extract → Decide) with status and key inputs/outputs per stage; use **Run triage** to process that email. Use **See logs…** to view every log line related to that email (micro task) from the central logging service for debugging (e.g. when Ingest fails or shows “Ingest fetch failed”).
- **Run all:** Use **Run all 50 emails** to process the full dataset (one email at a time in the background). The list and detail views update via short polling (~1.5 s). **Polling** shows “Polling…” only while at least one email is in progress; it stops automatically when no emails are running (completed or failed) or when a poll request fails (e.g. network error), so the status text is cleared.
- **Analysis mode:** Use the **Classifier** and **Decider** dropdowns (AI (LLM) vs Rule-based) to choose how emails are analyzed. Run triage with one setting, then switch and run again to compare output. Settings apply to "Run triage" and "Run all 50 emails".
- **Edit:** Use **Edit** (next to Run all 50 emails) to change any sample email for real-time testing: select an email from the list, edit subject, sender, and body, then Save. Edits are in-memory only; stages reset to pending so you can run triage on the updated content.
- **Dataset:** Single source of truth is `docs/sample_intent_dataset.json` (read-only on disk; in-memory copies can be edited via the UI). To reset workflow state, restart the service.

### Frontend URL (single canonical)

| Context | URL |
| --------| -----|
| **Production** | **<https://aeps.alfares.cz>** (frontend only; nothing else) |
| Local | `http://localhost:3374/` |
| Health | `http://localhost:3374/health` (local) or via backend |
| API (backend) | `GET /api/emails`, `GET /api/emails/:id`, `GET /api/emails/:id/logs` (See logs…), `PUT /api/emails/:id` (edit), `POST /api/emails/:id/run`, `POST /api/run-all`, `GET /api/settings`, `PUT /api/settings` (analysis mode: AI vs rule-based) |

**After deployment:** Run `./scripts/deploy.sh`; when the aeps.alfares.cz certificate is present (or symlinked from wildcard), **<https://aeps.alfares.cz>** is installed and available. The app is served at root `/`.

### Classifier/Decider show "rule-based" instead of LLM model

When you set **Classifier** and **Decider** to **AI (LLM)** but the stage response shows **model_used: "rule-based"**, the ai-microservice is not using OpenRouter. Ensure:

1. **ai-microservice** has **FREE_AI_SERVICE_URL** set in .env (e.g. in Docker it is set by docker-compose to the free-ai-service container URL).
2. **free-ai-service** can reach OpenRouter (OPENROUTER_API_KEY and OPENROUTER_MODEL in ai-microservice/.env free-ai-service .env).
3. This app sends the current dropdown choice with every run; the server also keeps the last saved choice (PUT /api/settings when you change the dropdown). If the UI shows AI (LLM) and you click Run, the request includes `useLlmClassifier: true` and `useLlmDecider: true`.

Check ai-microservice logs for "Email-triage LLM classify failed, falling back to rule-based" or "use_llm=True but FREE_AI_SERVICE_URL is not set".

## Port and port range

Ports use the **33xx shared microservice range**, aligned with root [README.md](../README.md) (3371–3373 = auth-microservice; 3380+ = ai-microservice). This service uses **3374 (blue)** and **3375 (green)** to avoid conflict:

| Port | Service |
| ----- | ------- |
| 3367 | logging-microservice |
| 3368 | notifications-microservice (blue) |
| 3369 | notifications-microservice (green) |
| 3370–3373 | auth-microservice (backend + frontend blue/green) |
| **3374** | **agentic-email-processing-system (blue)** |
| **3375** | **agentic-email-processing-system (green)** |
| 3380+ | ai-microservice |

Configure via `.env`: `PORT=3374`, `PORT_BLUE=3374`, `PORT_GREEN=3375`. The app listens on `PORT` (default 3374). Do not use ports outside the allowed range.

## Environment and services

All configuration is via `.env`; keys (no secret values) are in `.env.example`. Variable names match other services in the ecosystem (e.g. notifications-microservice) where applicable.

| Variable | Description | Example (Docker network) |
| -------- | ----------- | ------------------------- |
| `PORT` | Application port (33xx range) | `3374` |
| `PORT_BLUE` / `PORT_GREEN` | Blue/green deployment ports | `3374` / `3375` |
| `DOMAIN` | Service domain for nginx auto-registry | `aeps.alfares.cz` |
| `SERVICE_NAME` | Logging and auth registration | `agentic-email-processing-system` |
| `NGINX_NETWORK_NAME` | Docker network for blue/green | `nginx-network` |
| `LOGGING_SERVICE_URL` | Central logging (required) | `http://logging-microservice:3367` |
| `AUTH_SERVICE_URL` | Auth for API/queues (optional) | `http://auth-microservice:3370` |
| `AI_SERVICE_URL` | ai-microservice (email-triage agents) | `http://ai-microservice:3380` |
| `NOTIFICATION_SERVICE_URL` | Notifications (optional) | `http://notifications-microservice:3368` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Shared PostgreSQL (optional) | `db-server-postgres`, `5432`, … |
| `CLASSIFIER_CONFIDENCE_THRESHOLD` | Intent threshold (default 0.75) | `0.75` |
| `AUTO_RESPOND_ENABLED` | Feature flag for auto-respond | `true` / `false` |
| `LOG_DIR` | Local log directory (run logs stored in 3 places: central service, in-memory, and this dir) | `logs` (default) |

Production URLs (e.g. `https://ai.alfares.cz`, `https://logging.alfares.cz`) are set on the server; local `.env` uses Kubernetes service DNS names and the ports above.

### Ensuring LOGGING_SERVICE_URL and AI_SERVICE_URL

- **LOGGING_SERVICE_URL** must be reachable from this app so that **"See logs…"** in the Web UI returns data. Set it to the central logging microservice (e.g. `http://logging-microservice:3367` on Docker network, or the production logging URL). The app sends all agent events there and queries by `service=` and `message_id` for the logs modal.
- **AI_SERVICE_URL** must point at the deployed **ai-microservice** that exposes the email-triage agents (`POST /api/email-triage/ingest`, `classify`, `extract`, `decide`). Use the orchestrator base URL (e.g. `http://ai-microservice:3380` or `https://ai.alfares.cz`).

**Production (<https://aeps.alfares.cz>z>z>):** For triage to work, **ai-microservice must be deployed on the same server** and attached to **nginx-network** with alias `ai-microservice` (so the AEPS container can resolve `http://ai-microservice:3380`). Leave `AI_SERVICE_URL` unset or set `AI_SERVICE_URL=http://ai-microservice:3380` in `.env`. Deploy ai-microservice first (or ensure it is running) so the alias is registered. If ingest fails with timeout, check logs for `cause_code` (`ENOTFOUND` = hostname not resolved; `ECONNREFUSED` = orchestrator not listening; `ETIMEDOUT` = connect/read too slow). From the server, run `docker exec agentic-email-processing-system-green node /app/scripts/check-ai-incontainer.js` (or `-blue`) to verify connectivity from inside the AEPS container. Ensure both AEPS and ai-microservice use the same Docker network (`nginx-network`); if the AI orchestrator is slow on first request, ensure its healthcheck has passed before traffic is switched.

**Verify connectivity:** `GET /health` returns `logging` and `ai` with values:

- `ok` — service reachable (See logs… and triage will work).
- `unreachable` — request failed or non-2xx (check URL, network, and that the other service is up).
- `not_configured` — env var missing or empty.

Example (local): `curl -s http://localhost:3374/health | jq .`

### CORS

API responses allow cross-origin requests from `*.alfares.cz`, `localhost`, and `127.0.0.1` so that browser calls from <https://aeps.alfares.cz>z>z> (or other alfares.cz subdomains) do not get 403. Same-origin requests do not require CORS; this covers cross-subdomain use (e.g. a frontend on another subdomain calling this API).

### Troubleshooting: AI service timeout

If you see **"AI service unreachable … The operation was aborted due to timeout"** (or similar), the call from AEPS to `AI_SERVICE_URL` (e.g. `http://ai-microservice:3380`) is failing. Check logs for `cause_code`:

| `cause_code` | Meaning | What to do |
|--------------|---------|------------|
| `ENOTFOUND` | Hostname not resolved | AEPS and ai-microservice must use the same Docker network (`nginx-network`); ensure ai-microservice is deployed and has alias `ai-microservice`. |
| `ECONNREFUSED` | Orchestrator not listening | Start or restart ai-microservice; confirm its healthcheck passes. |
| `ETIMEDOUT` | Connect or read took too long | Check ai-orchestrator logs for slow/failing ingest; ensure traffic is switched only after orchestrator healthcheck has passed (avoids cold-start timeouts). |

The error message now includes `cause_code=` when present (e.g. `cause_code=ENOTFOUND`) so you can see the reason in the same log line as "Stage failed".

**After deployment:** On the server, ensure both stacks are on the same Docker network and the AI orchestrator is up:

1. `docker network inspect nginx-network` — should list both `agentic-email-processing-system-*` and `ai-microservice-orchestrator-*` (or the active slot).
2. Deploy **ai-microservice on this host** (before or with AEPS) so the `ai-microservice` alias exists on nginx-network. If you only deploy AEPS, the UI will show "AI service unreachable ... timeout" because no container answers to `ai-microservice:3380`.
3. **Only one ai-microservice stack (blue or green) must be running.** If both blue and green are up, the alias `ai-microservice` can resolve to the wrong or unhealthy container and cause timeouts. After ai-microservice deploy, the inactive stack is stopped.
4. `docker exec agentic-email-processing-system-green node /app/scripts/check-ai-incontainer.js` — verifies connectivity from inside the AEPS container (or use `-blue` for the blue slot).

**From the server:** Run connectivity from inside the AEPS container:

- `docker exec agentic-email-processing-system-green node /app/scripts/check-ai-incontainer.js` (or `-blue`)

If that succeeds but triage still times out, the orchestrator may be overloaded or the ingest endpoint may be slow; check ai-orchestrator and ingest logs.

## Testing

Tests verify that the **AI LLM service is accessible** and that all **Ingest → Classify → Extract → Decide** endpoints (and full triage) respond correctly.

### Endpoint tests (Ingest → Classify → Extract → Decide + triage)

- **Script:** `scripts/test-email-triage-endpoints.js`
- **Usage:** `npm run test:endpoints` or `node scripts/test-email-triage-endpoints.js`
- The script:
  1. **GET /health** — Checks AI and logging reachability from AEPS.
  2. **POST /api/ingest** — Validates and normalizes email; checks `success`, `payload`.
  3. **POST /api/classify** — Intent and confidence; checks taxonomy (support, sales, technical, etc.).
  4. **POST /api/extract** — Entities; checks `entities` object.
  5. **POST /api/decide** — Action; checks action set (auto_respond, route_to_queue, escalate).
  6. **POST /api/triage** — Full pipeline; checks intent and action.
- **Base URL:** Set `AEPS_URL` if the app is not on the default (e.g. `AEPS_URL=http://localhost:3375`).
- **Exit:** 0 if all checks pass, 1 if any fail. All steps run even if one fails (full report).

### AI service connectivity (direct)

To verify the AI microservice itself (health, ready, ingest) without going through AEPS:

- **Script:** `scripts/check-ai-connectivity.js`
- **Usage:** `npm run test:ai` or `node scripts/check-ai-connectivity.js`
- Uses `AI_SERVICE_URL` (e.g. `http://ai-microservice:3380` in Docker, `http://localhost:3380` on host).

### Run all tests

One command runs AI connectivity, endpoint tests (Ingest → Classify → Extract → Decide + triage), and CLI curl tests. The script starts AEPS on a free test port (3376–3378) with `AI_SERVICE_URL=http://localhost:3380`, so the AI service must be reachable on port 3380 (e.g. host or port-mapped).

- **Usage:** `npm test` or `./scripts/run-all-tests.sh`
- **Requires:** AI service running at `AI_SERVICE_URL` (default `http://localhost:3380`).
- **Exit:** 0 if all pass, 1 if any fail.

Additional curl-based tests only: `scripts/test-api-from-cli.sh` (set `AEPS_URL` and `AI_SERVICE_URL` as needed).

## Deployment

Configuration and deployment follow the common approach (see [CREATE_SERVICE.md](../CREATE_SERVICE.md)): `.env` as single source of truth, integration with shared microservices, blue/green via nginx-microservice.

**Nginx config (codebase only; per [DEPLOY_STANDARD.md](../shared/docs/DEPLOY_STANDARD.md), define each `server_name` in only one config to avoid conflicts):**

- `nginx/aeps.alfares.cz.conf` — Single file: vhost for **aeps.alfares.cz** only (no long domain here). Placeholder `{{AEPS_UPSTREAM}}` is replaced by deploy script with `agentic-email-processing-system-blue` or `-green`; result is copied to nginx-microservice `conf.d/aeps.alfares.cz.conf` (same naming pattern as other domain configs). Main domain is only in blue-green generated config.

### Production (Docker + blue/green)

- **Build:** `docker compose build` or `docker build -t agentic-email-processing-system .`
- **Run locally (single container):** `docker compose up -d` (requires `nginx-network` and `.env`).
- **Deploy to production (alfares.cz):** On the **production server** (e.g. `ssh statex`), from this repo after `git pull`, run:

  ```bash
  ./scripts/deploy.sh
  ```

  This calls `nginx-microservice/scripts/blue-green/deploy-smart.sh agentic-email-processing-system`, which builds the image, runs health checks, and switches traffic. The script then installs **<https://aeps.alfares.cz>** by substituting the active upstream (blue or green) into `nginx/aeps.alfares.cz.conf` and copying to nginx-microservice `conf.d/`. No duplicate `server_name`; no manual nginx edits on prod. Deploy must be run where shared services (`LOGGING_SERVICE_URL`, `AI_SERVICE_URL`) are reachable on the same Docker network.

**First-time setup on production:** Ensure the service is registered in nginx-microservice (e.g. run `./scripts/add-service-registry.sh agentic-email-processing-system` from the nginx-microservice directory and set domain, production path, container name base `agentic-email-processing-system`, container port `3374`, health endpoint `/health`). Then run `./scripts/deploy.sh` from this repo. For **aeps.alfares.cz** HTTPS, the deploy script creates a symlink `certificates/aeps.alfares.cz` → `alfares.cz` when a wildcard cert exists; otherwise ensure a certificate for `aeps.alfares.cz` is present in nginx-microservice's `certificates/`.

**If <https://aeps.alfares.cz>z>z> returns 404 after a deploy:** The deploy script no longer removes `aeps.alfares.cz.conf` before the blue/green run (so a failed deploy does not leave the site broken). Re-run `./scripts/deploy.sh` to restore or update the aeps config.
