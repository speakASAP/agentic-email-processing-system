# Agentic Email Processing System — Implementation Plan

This plan tracks implementation of the production system described in `docs/agents/master-prompt-development.md`. Tasks are updated continuously and completed items are marked with ✅.

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
  - `docs/FIVE_APPROACHES.md`
  - `docs/INTEGRATION.md`
  - Root `CREATE_SERVICE.md`
  - `ai-microservice/README.md`

## 2. Backend — Demo Dataset and Workflow State

Goal: Manage the fixed 50-email dataset and expose per-email workflow state for the frontend, without changing ai-microservice contracts.

- ✅ Load and normalize the 50-email test dataset
  - ✅ Internal module `lib/email_dataset.js` loads `docs/sample_intent_dataset.json` at startup (single source of truth).
  - ✅ Each item has stable `message_id` and dataset `label` for verification.
- ✅ Represent per-email workflow state in memory
  - ✅ Per-stage status: ingest, classify, extract, decide (pending, running, success, failed).
  - ✅ Store inputs/outputs for frontend (intent, confidence, entities, action, escalation_reason, queue, errors).
  - ✅ In-memory store; compatible with future DB-backed version.
- ✅ Backend API for the dataset
  - ✅ `GET /api/emails` — List emails with message_id, subject, preview, status, category, action.
  - ✅ `GET /api/emails/:message_id` — Detail: payload, per-stage status, inputs/outputs, escalation.
  - ✅ `PUT /api/emails/:message_id` — Update email payload in-memory (subject, sender, body_plain, etc.) for real-time testing; stages reset to pending.
  - ✅ `POST /api/emails/:message_id/run` — Run full pipeline for one email (202 + background).
  - ✅ `POST /api/run-all` — Run all emails one-by-one (202 + background).
- ✅ Logging and observability
  - ✅ `utils/logger.js` used for run start/end and errors; pipeline events go to `LOGGING_SERVICE_URL`.
  - ✅ Demo state reflects errors so frontend shows failed states.

## 3. Frontend — Workflow Visualization UI

Goal: Provide a clear, modern Web UI that allows stakeholders to inspect each email and see the full agentic workflow.

- ✅ Choose and document frontend approach
  - ✅ Minimal static frontend in `public/app/` served at root `/`. Production: **<https://aeps.alfares.cz>** only.
  - ✅ Documented in this plan and in README Demo section.
- ✅ Email list view
  - ✅ Page at `/` lists all emails with subject, preview, status, category, action.
  - ✅ Filter by status and category (dropdowns).
- ✅ Email detail view
  - ✅ Stepper for Ingest, Classify, Extract, Decide with status and key inputs/outputs.
  - ✅ Run triage button triggers `POST /api/emails/:id/run`.
  - ✅ **See logs…** button opens a modal with every log line for this email (micro task) from the central logging service; backend `GET /api/emails/:message_id/logs` filters by message_id for faster debugging and customer satisfaction.
- ✅ Edit dataset for testing
  - ✅ **Edit** button next to **Run all 50 emails** opens a modal to select any of the 50 emails and edit subject, sender, and body (plain text). Save updates in-memory and resets stages so stakeholder can run triage on the modified email.
- ✅ Near real-time updates
  - ✅ Short-polling (~1.5 s) so stage transitions visible without refresh.
  - ✅ UI shows pending / running / completed / failed per stage.
  - ✅ Polling stops when no emails are running (all completed or failed) or when a poll request fails (e.g. fetch failed); “Polling…” is cleared so the UI does not suggest ongoing activity after failure or completion.

## 4. Flow and Documentation

Goal: Make it easy to run the 50-email test dataset end-to-end and understand what to look for.

- ✅ Document usage in `README.md`
  - ✅ Demo section: start service, open `/` (local) or <https://aeps.alfares.cz> (prod), run one or all emails, interpret stages.
- ✅ Ensure test run is reproducible
  - ✅ `docs/sample_intent_dataset.json` is single source; backend does not mutate it.
  - ✅ Reset state by restarting the service (in-memory).

## 5. Deployment Readiness

Goal: Align implementation with the ecosystem’s blue/green deployment and nginx-microservice patterns.

- ✅ Validate nginx integration
  - ✅ `nginx/nginx-api-routes.conf` has `/`, `/api/*`, `/health`. `nginx/aeps.alfares.cz.conf` — single file, aeps.alfares.cz only (no long domain; per DEPLOY_STANDARD avoid duplicate server_name). Deploy script substitutes `{{AEPS_UPSTREAM}}` and copies to conf.d.
  - ✅ `scripts/deploy.sh` runs nginx-microservice deploy-smart.sh for blue/green; no changes to shared microservices.
- ✅ Document deployment steps
  - ✅ README: deployment follows common approach; nginx routes from config; no manual nginx on prod.

## 6. Next Immediate Steps (Execution Order)

1. ✅ Backend dataset module and API (Section 2).
2. ✅ Logging wired via `utils/logger.js` (Section 2).
3. ✅ Frontend UI list + detail + short polling (Section 3).
4. ✅ README instructions (Section 4).
5. ✅ Nginx and deployment review (Section 5); containerization as needed.

## 7. Documentation and Alignment (master-prompt-development.md further)

Goal: Align implementation with design docs and success criteria; keep documentation current.

- ✅ Update FIVE_APPROACHES.md
  - ✅ Section 3 "Reliability and Observability": added "Implementation (current prototype)" describing logging schema, central logging integration via `utils/logger.js`, and that runbooks are ops responsibility.
- ✅ Explanation trail in frontend
  - ✅ Detail view shows a one-line "explanation" summary (why escalated, routed where, action, category + confidence) so stakeholders see how the final decision was reached without reloading.
- ✅ Observability checklist document
  - ✅ `docs/OBSERVABILITY_CHECKLIST.md` created; referenced by README, SYNC_D_VALIDATION, and EMAIL_TRIAGE_TASKS_INDEX. Covers central logging, event schema, pipeline steps, error/escalation logging, logs API.
- ✅ Endpoint test script and documentation
  - ✅ `scripts/test-email-triage-endpoints.js` tests Ingest → Classify → Extract → Decide and POST /api/triage; README Testing section and docs/INTEGRATION.md updated; AEPS_URL in .env.example.

---

## 8. Current Status Summary and Action Plan

### Status vs. master-prompt-development.md

Execution of `docs/agents/master-prompt-development.md` is **substantially complete**. All success criteria (§8) are met:

| Criterion | Status |
| --------- | ------ |
| 1. End-to-end: 50 emails through full pipeline; max 30 items/request; errors handled and logged | ✅ Done (run-all processes one-by-one; logging via utils/logger.js) |
| 2. Frontend: list + detail, stages, status, I/O, real-time updates | ✅ Done (short polling ~1.5 s, stepper, See logs…, Edit) |
| 3. Integration: ai-microservice + logging correct | ✅ Done (AI_SERVICE_URL, LOGGING_SERVICE_URL; contracts followed) |
| 4. Deployment documented and repeatable | ✅ Done (README, scripts/deploy.sh, nginx in codebase) |
| 5. Documentation up to date | ✅ Done (this plan with ✅; FIVE_APPROACHES updated; README; OBSERVABILITY_CHECKLIST added) |

### Completed in This Pass

- **Missing artifact fixed:** `docs/OBSERVABILITY_CHECKLIST.md` was referenced by README, SYNC_D_VALIDATION, and EMAIL_TRIAGE_TASKS_INDEX but did not exist. It has been created and aligns with event-schema, logger usage, and Sync D.

### Remaining (Optional / Verification)

No mandatory implementation work remains for the master-prompt-development scope. Optional follow-ups:

1. **Smoke test on prod:** After `git pull` on prod, run `./scripts/deploy.sh` and verify <https://aeps.alfares.cz> loads, then run one email and "Run all 50" to confirm end-to-end and polling.
2. **Logging microservice:** Ensure `LOGGING_SERVICE_URL` is reachable from the app (local and prod) so "See logs…" returns data; if not, check network and env.
3. **ai-microservice:** Ensure email-triage agents (ingest, classify, extract, decide) are deployed and `AI_SERVICE_URL` points to them; otherwise triage will fail with 503 or ingest/classify errors.
4. **Optional — LLM Classifier and Decider:** In ai-microservice, set `EMAIL_TRIAGE_LLM_CLASSIFIER=true` and/or `EMAIL_TRAIGE_LLM_DECIDER=true` to run classify/decide via free-ai-service (OpenRouter). When unset or on LLM failure, rule-based agents are used. See [INTEGRATION.md](INTEGRATION.md) and ai-microservice README.

If new requirements appear (e.g. persistence to DB, new intents, or different frontend), add them as new tasks in Section 2–7 and track with ✅ as they are completed.
