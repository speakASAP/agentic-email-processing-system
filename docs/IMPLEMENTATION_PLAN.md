# Agentic Email Processing System — Implementation Plan

This plan tracks implementation of the production demo described in `docs/agents/master-prompt-development.md`. Tasks are updated continuously and completed items are marked with ✅.

## 1. Current Status

- ✅ Phase 0 contracts defined (`docs/contracts/*.md`).
- ✅ Phase 1–3 backend endpoints implemented for single-email triage:
  - `POST /api/ingest`
  - `POST /api/classify`
  - `POST /api/extract`
  - `POST /api/decide`
  - `POST /api/triage`
- ✅ Core integration with `ai-microservice` and centralized logging (`utils/logger.js`) is in place.
- ✅ Environment keys and `.env` / `.env.example` are configured according to `CREATE_SERVICE.md`.
- ✅ Core documentation reviewed:
  - `README.md`
  - `docs/agents/master-prompt.md`
  - `docs/agents/master-prompt-development.md`
  - `docs/EMAIL_TRIAGE_TASKS_INDEX.md`
  - `docs/FIVE_APPROACHES_DEUTSCHE_TELEKOM.md`
  - `docs/INTEGRATION.md`
  - Root `CREATE_SERVICE.md`
  - `ai-microservice/README.md`

## 2. Backend — Demo Dataset and Workflow State

Goal: Manage the fixed 50-email dataset and expose per-email workflow state for the frontend, without changing ai-microservice contracts.

- ✅ Load and normalize the 50-email demo dataset
  - ✅ Internal module `lib/demo_dataset.js` loads `docs/sample_intent_dataset.json` at startup (single source of truth).
  - ✅ Each item has stable `message_id` and dataset `label` for verification.
- ✅ Represent per-email workflow state in memory
  - ✅ Per-stage status: ingest, classify, extract, decide (pending, running, success, failed).
  - ✅ Store inputs/outputs for frontend (intent, confidence, entities, action, escalation_reason, queue, errors).
  - ✅ In-memory store; compatible with future DB-backed version.
- ✅ Backend demo API for the dataset
  - ✅ `GET /api/demo/emails` — List emails with message_id, subject, preview, status, category, action.
  - ✅ `GET /api/demo/emails/:message_id` — Detail: payload, per-stage status, inputs/outputs, escalation.
  - ✅ `PUT /api/demo/emails/:message_id` — Update email payload in-memory (subject, sender, body_plain, etc.) for real-time testing; stages reset to pending.
  - ✅ `POST /api/demo/emails/:message_id/run` — Run full pipeline for one email (202 + background).
  - ✅ `POST /api/demo/run-all` — Run all emails one-by-one (202 + background).
- ✅ Logging and observability for demo mode
  - ✅ `utils/logger.js` used for demo run start/end and errors; pipeline events go to `LOGGING_SERVICE_URL`.
  - ✅ Demo state reflects errors so frontend shows failed states.

## 3. Frontend — Workflow Visualization UI

Goal: Provide a clear, modern demo UI that allows stakeholders to inspect each email and see the full agentic workflow.

- ✅ Choose and document frontend approach
  - ✅ Minimal static frontend in `public/demo/` served at root `/`. Production: **https://aeps.alfares.cz** only.
  - ✅ Documented in this plan and in README Demo section.
- ✅ Email list view
  - ✅ Page at `/` lists all emails with subject, preview, status, category, action.
  - ✅ Filter by status and category (dropdowns).
- ✅ Email detail view
  - ✅ Stepper for Ingest, Classify, Extract, Decide with status and key inputs/outputs.
  - ✅ Run triage button triggers `POST /api/demo/emails/:id/run`.
- ✅ Edit dataset for testing
  - ✅ **Edit** button next to **Run all 50 emails** opens a modal to select any of the 50 emails and edit subject, sender, and body (plain text). Save updates in-memory and resets stages so stakeholder can run triage on the modified email.
- ✅ Near real-time updates
  - ✅ Short-polling (~1.5 s) so stage transitions visible without refresh.
  - ✅ UI shows pending / running / completed / failed per stage.
  - ✅ Polling stops when no emails are running (all completed or failed) or when a poll request fails (e.g. fetch failed); “Polling…” is cleared so the UI does not suggest ongoing activity after failure or completion.

## 4. Demo Flow and Documentation

Goal: Make it easy to run the 50-email demo end-to-end and understand what to look for.

- ✅ Document demo usage in `README.md`
  - ✅ Demo section: start service, open `/` (local) or https://aeps.alfares.cz (prod), run one or all emails, interpret stages.
- ✅ Ensure demo is reproducible
  - ✅ `docs/sample_intent_dataset.json` is single source; backend does not mutate it.
  - ✅ Reset state by restarting the service (in-memory).

## 5. Deployment Readiness

Goal: Align demo implementation with the ecosystem’s blue/green deployment and nginx-microservice patterns.

- ✅ Validate nginx integration
  - ✅ `nginx/nginx-api-routes.conf` has `/`, `/api/*`, `/health`. `nginx/aeps.alfares.cz.blue.conf` and `nginx/aeps.alfares.cz.green.conf` — one config per color (same blue/green approach as other microservices): redirect long domain to https://aeps.alfares.cz and proxy to the active container. Deploy script copies the one matching the main-domain symlink (codebase only).
- ✅ Containerization and scripts
  - ✅ Dockerfile + .dockerignore; docker-compose.yml, docker-compose.blue.yml, docker-compose.green.yml (ports 3374/3375, nginx-network).
  - ✅ `scripts/deploy.sh` runs nginx-microservice deploy-smart.sh for blue/green; no changes to shared microservices.
- ✅ Document deployment steps
  - ✅ README: deployment follows common approach; nginx routes from config; no manual nginx on prod.

## 6. Next Immediate Steps (Execution Order)

1. ✅ Backend demo dataset module and demo API (Section 2).
2. ✅ Logging wired via `utils/logger.js` (Section 2).
3. ✅ Frontend UI list + detail + short polling (Section 3).
4. ✅ README demo instructions (Section 4).
5. ✅ Nginx and deployment review (Section 5); containerization as needed.

## 7. Documentation and Alignment (master-prompt-development.md further)

Goal: Align implementation with design docs and success criteria; keep documentation current.

- ✅ Update FIVE_APPROACHES_DEUTSCHE_TELEKOM.md
  - ✅ Section 3 "Reliability and Observability": added "Implementation (current prototype)" describing logging schema, central logging integration via `utils/logger.js`, and that runbooks are ops responsibility.
- ✅ Explanation trail in frontend
  - ✅ Detail view shows a one-line "explanation" summary (why escalated, routed where, action, category + confidence) so stakeholders see how the final decision was reached without reloading.
