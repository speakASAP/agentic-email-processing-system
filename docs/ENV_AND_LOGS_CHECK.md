# Environment and logs check (use_llm / LLM vs rule-based)

## 1. Environment variables

### ai-microservice (.env)

| Variable | Required for LLM | Status / note |
|----------|------------------|----------------|
| `FREE_AI_SERVICE_URL` | **Yes** | Must point to free-ai-service (e.g. `http://free-ai-service:3386`). Added if missing; backup: `.env.backup.YYYYMMDD`. |
| `OPENROUTER_API_KEY` | Yes (for free-ai-service) | Set in free-ai-service env. |
| `EMAIL_TRIAGE_LLM_CLASSIFIER` / `EMAIL_TRIAGE_LLM_DECIDER` | No | Optional; UI sends `use_llm` in request body. |
| `LOGGING_SERVICE_URL` | For central logs | Set. |

### agentic-email-processing-system (.env)

| Variable | Required | Status / note |
|----------|----------|----------------|
| `AI_SERVICE_URL` | **Yes** | Must point to ai-orchestrator (e.g. `http://ai-microservice:3380`). Set. |
| `LOGGING_SERVICE_URL` | For central logs | Set. |

## 2. Where to check logs

### AEPS

- **Central logging:** `LOGGING_SERVICE_URL` + `LOGGING_SERVICE_API_PATH` (e.g. query by `service=aeps-service` or `agentic-email-processing-system`).
- **In-memory / UI:** "See logs…" for an email shows run log lines (including `model_used`).
- **Local file:** `LOG_DIR/run.log` (default `logs/run.log`) — append-only run log.

### ai-microservice

- **Central logging:** Same logging service; query by `service=ai-microservice`.
- **Container stdout:** Orchestrator and free-ai-service log to stdout (Docker logs).

## 3. Log points for use_llm / model_used (action plan)

Search logs for these to trace where the parameter is set or lost:

| Point | Where | Grep / message |
|-------|--------|----------------|
| Run one/run-all options | AEPS server | `Triage pipeline options (run one)` or `(run-all)` |
| Pipeline start | AEPS | `Triage pipeline started` + `useLlmClassifier`, `useLlmDecider` |
| Classify request | AEPS | `Classify request body (use_llm)` |
| Classify response | AEPS | `Classify response (model_used)` |
| Decide request | AEPS | `Decide request body (use_llm)` |
| Decide response | AEPS | `Decide response (model_used)` |
| AI client send | AEPS | `AI client sending use_llm to ai-microservice` |
| Classify/decide entry | ai-orchestrator | `Email-triage classify/decide request body keys` + `use_llm_in_body` |
| After coerce | ai-orchestrator | `Email-triage classify/decide request received` + `use_llm`, `use_llm_raw`, `free_ai_url_set` |
| Return | ai-orchestrator | `Email-triage classify/decide success (returning)` + `model_used`, `use_llm_was` |
| ERROR (rule-based when LLM requested) | ai-orchestrator | `LLM requested but classifier/decider returned rule-based` + `point=ai_orchestrator_classify_raise` or `_decide_raise` |
| ERROR (pipeline) | AEPS | `LLM requested but classifier/decider returned rule-based` + `point=triage_pipeline_after_classify` or `_decide` |

## 4. Quick verification

1. Set Classifier and Decider to **AI (LLM)** in the UI.
2. Run one email or Run all 50.
3. In "See logs…" for an email, confirm:
   - `Stage completed: classify — model: <OpenRouter model>` (e.g. `google/gemini-2.0-flash-exp:free`).
   - `Stage completed: decide — model: <OpenRouter model>`.
4. If you see `model: rule-based` or a 503/ERROR, follow the log points above and check `FREE_AI_SERVICE_URL` and free-ai-service reachability.
