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

---

## 2. Where and how to check logs (maximum detail)

Logs are written to **three places** in AEPS; ai-microservice uses central logging and stdout.

### 2.1 AEPS — In-memory run logs (per email)

**What:** Per-email triage run entries (stage started/completed, `model_used`, errors). Cleared when you click **Clear all** or **Clear** for one email, and **reset when a new triage run starts** (Run triage / Run all 50). Max **100 entries per email** (oldest dropped when buffer is full). The same entries are also appended to the local file (2.2); they are **not** sent to central logging by pushRunLog (see 2.6).

**Where in code:** `server.js` → `runLogBuffer` (Map keyed by `message_id`). Filled by `pushRunLog(message_id, level, message, metadata)`.

**Entry structure (each log line):**

```json
{
  "level": "info",
  "message": "Stage completed: classify · google/gemini-2.0-flash-exp:free",
  "service": "aeps-service",
  "timestamp": "2026-03-08T12:00:00.000Z",
  "metadata": {
    "message_id": "sample-002",
    "stage": "classify",
    "model_used": "google/gemini-2.0-flash-exp:free",
    "progress": "classify",
    "finished_at": "..."
  }
}
```

**Where in the UI:**

| Place | How to open | What you see |
|-------|----------------|--------------|
| **Detail panel — Logs (per stage)** | Open an email from the list → expand a stage (Ingest / Classify / Extract / Decide) → section **Logs** inside the stage body | Logs for this email (cached after first load). Same source as "See logs…". |
| **Logs modal** | Open an email → button **"See logs…"** (top of detail view) | Full log list for this email: in-memory first, then merged with central. Each line: timestamp, level, message, metadata (including `model_used` for classify/decide). |

**How to view via API (same data as UI):**

- **In-memory only (no central fetch, fastest):**  
  `GET /api/emails/<message_id>/logs?source=memory`  
  Example:

  ```bash
  curl -s "https://aeps.alfares.cz/api/emails/sample-002/logs?source=memory"
  ```

  Response: `{ "logs": [ { "level", "message", "timestamp", "metadata" }, ... ] }`.

- **Merged with central (default):**  
  `GET /api/emails/<message_id>/logs`  
  Optional query: `?limit=300` (max 500).  
  Example:

  ```bash
  curl -s "https://aeps.alfares.cz/api/emails/sample-002/logs?limit=300"
  ```

  Response: `{ "logs": [...], "error": "..." }` (optional `error` if central fetch failed; in-memory is still returned).

**Filtering after Clear all:**  
When you click **Clear all**, the server sets `logsClearAllTimestamp` and clears `runLogBuffer` for all emails. The logs API then returns only entries with `timestamp >= logsClearAllTimestamp` (for both in-memory and central results). So **no old logs** appear in the UI or API after a clear.

---

### 2.2 AEPS — Local file (append-only run log)

**What:** Every `pushRunLog` call is also appended to a file (one JSON object per line). **Not cleared by Clear all**; contains history across runs. Useful for post-mortem or when central logging is down.

**Where on disk:**  
`<LOG_DIR>/run.log`  

- `LOG_DIR` from `.env` (e.g. `LOG_DIR=logs`). Default: `logs` relative to the server process (when run from repo: `<project_root>/agentic-email-processing-system/logs/run.log`).  
- If `LOG_DIR` is absolute (e.g. `/var/log/aeps`), file is at `/var/log/aeps/run.log`.  
- Code: `server.js` → `getRunLogPath()` (uses `LOG_DIR`, default `RUN_LOG_FILE = 'run.log'`).

**How to view:**

```bash
# From project root (agentic-email-processing-system)
tail -f logs/run.log

# With LOG_DIR from .env
tail -f "${LOG_DIR:-logs}/run.log"

# Last 50 lines
tail -n 50 logs/run.log

# Grep for a specific message_id (metadata field)
grep '"message_id":"sample-002"' logs/run.log

# Grep for use_llm / model_used (classify/decide)
grep -E 'use_llm|model_used' logs/run.log

# Grep for errors only
grep '"level":"error"' logs/run.log

# Grep for stage completed (incl. model name)
grep 'Stage completed' logs/run.log
```

Each line is a single JSON object: `{ "level", "message", "service", "timestamp", "metadata" }`. No newlines inside a line.

---

### 2.3 AEPS — Central logging service (POST + query)

**What:** `utils/logger.js` sends each `logger.info` / `logger.error` / `logger.emitEvent` to the central logging microservice (POST). All server and pipeline logs (including use_llm flow) go there. For the first **30 seconds** after startup, logs are written only to **console** (so healthchecks are not slowed); after that, POST is used. If POST fails or times out (2s), the line is still printed to console (2.4).

**Env:**  

- `LOGGING_SERVICE_URL` — base URL (e.g. `https://logging.alfares.cz`, `http://logging-microservice-backend-green:3367`). If empty, central POST is skipped.  
- `LOGGING_SERVICE_API_PATH` — path for **POST** (default `/api/logs`).  
- **Query** is always: `GET <base>/api/logs/query?service=...&limit=...` (path is fixed in AEPS code).

**How logs are sent (POST):**  

- URL: `LOGGING_SERVICE_URL + LOGGING_SERVICE_API_PATH` (e.g. `https://logging.alfares.cz/api/logs`).  
- Body: `{ "level": "info", "message": "...", "service": "<SERVICE_NAME>", "timestamp": "<ISO>", "metadata": { ... } }`.  
- `service` = `SERVICE_NAME` from AEPS `.env` (e.g. `aeps-service`).

**How to view (query central logs):**

- **Logging microservice admin UI (if available):**  
  Open the logging service web UI (e.g. `https://logging.alfares.cz`). Filter by **service** = `aeps-service` (or whatever `SERVICE_NAME` is in AEPS .env). Logs show timestamp, level, message, service, metadata.

- **Direct query API (curl):**  

  ```bash
  GET <LOGGING_SERVICE_URL>/api/logs/query?service=<SERVICE_NAME>&limit=<N>
  ```

  Example (replace host if different):

  ```bash
  curl -s "https://logging.alfares.cz/api/logs/query?service=aeps-service&limit=300"
  ```

  Typical response shape: `{ "data": [ { "timestamp", "level", "message", "service", "metadata" }, ... ] }`. Exact shape is logging-microservice-specific.

- **Filter by message_id:**  
  The central API may not support a `message_id` query param. AEPS does the filter when you use **GET /api/emails/:message_id/logs**: it fetches from central with `service` and `limit`, then keeps only entries where `metadata.message_id === message_id` and applies the Clear-all timestamp filter. So for “logs for one email” use the AEPS endpoint; for “all AEPS logs” use the central query above.

---

### 2.4 AEPS — Process stdout / console

**What:** For the first 30 seconds after startup, and whenever the central logging request fails or times out, `utils/logger.js` writes the same log line to the Node process stdout (Docker logs, PM2, or terminal). So **stdout always has a copy** during grace period or on central failure.

**How to view:**

- **Docker (deployed AEPS):**  
  Container name is typically `agentic-email-processing-system-blue` or `agentic-email-processing-system-green` (active slot).  

  ```bash
  docker ps --format '{{.Names}}' | grep -E 'agentic-email|aeps'
  docker logs -f agentic-email-processing-system-blue
  docker logs --tail 500 agentic-email-processing-system-blue
  ```

- **PM2:**  
  `pm2 logs <aeps-app-name>`
- **Local run:**  
  Terminal where `node server.js` (or `npm start`) is running.

**Format:** `[<timestamp>] [<level>] [<SERVICE_NAME>] <message> <metadata>`  
Example: `[2026-03-08T12:00:00.000Z] [info] [aeps-service] Triage pipeline started { useLlmClassifier: true, useLlmDecider: true }`

**Grep stdout (Docker):**

```bash
docker logs agentic-email-processing-system-blue 2>&1 | grep -E 'use_llm|model_used|classify|decide'
docker logs agentic-email-processing-system-blue 2>&1 | grep -E 'ERROR|POINT OF FAILURE'
```

---

### 2.5 ai-microservice — Central logging and stdout

**What:** ai-orchestrator and free-ai-service use their own logger; they POST to the same central logging service (if configured) and log to stdout. Use these when tracing **use_llm**, **model_used**, or 503/classify/decide failures.

**How to view:**

- **Central logging:**  
  Same base URL as in 2.3. Query by service name (often `ai-microservice` or as in orchestrator .env):  

  ```bash
  curl -s "https://logging.alfares.cz/api/logs/query?service=ai-microservice&limit=300"
  ```

- **Stdout (Docker):**  
  Container names are typically `ai-microservice-orchestrator-blue` / `-green`, `ai-microservice-free-ai-service-blue` / `-green`.  

  ```bash
  docker ps --format '{{.Names}}' | grep ai-microservice
  docker logs -f ai-microservice-orchestrator-blue
  docker logs -f ai-microservice-free-ai-service-blue
  ```

  **Orchestrator** (classify/decide, use_llm, FREE_AI_SERVICE_URL):  

  ```bash
  docker logs ai-microservice-orchestrator-blue 2>&1 | grep -E 'classify|decide|use_llm|model_used|POINT OF FAILURE'
  ```

  **Free-ai-service** (OpenRouter 404, model fallback):  

  ```bash
  docker logs ai-microservice-free-ai-service-blue 2>&1 | grep -E 'OpenRouter|404|model|analyze'
  ```

---

### 2.6 What gets written where (AEPS)

| Source | In-memory (runLogBuffer) | Local file (run.log) | Central (POST) | Stdout |
|--------|--------------------------|----------------------|----------------|--------|
| **pushRunLog** (server.js) | Yes (per message_id) | Yes (append) | No (not sent by pushRunLog) | No |
| **logger.info / logger.error / logger.emitEvent** (utils/logger.js) | No | No | Yes (after 30s grace) | Yes (during grace or on central failure) |

So: **run log lines** (stage started/completed, model_used, errors) come from `pushRunLog` → in-memory + file. **General server/pipeline logs** (request body, use_llm flow, events) come from `logger` → central + stdout. The UI "See logs…" shows **in-memory run log** merged with **central** (filtered by message_id and Clear-all time); central entries include both logger.* and any logs the logging microservice stores from other sources.

---

### 2.7 Troubleshooting: no logs or empty logs

| Symptom | Where to check | What to do |
|---------|----------------|------------|
| **"See logs…" empty after a run** | In-memory + central. | Ensure the run actually completed (check stage status). After **Clear all**, only logs with timestamp ≥ clear time are shown. Try `?source=memory` to rule out central timeout. |
| **No run log lines in file** | `LOG_DIR/run.log` | Check `LOG_DIR` in .env and that the process can write (permissions). Default `logs/run.log` relative to process cwd. |
| **No central logs for AEPS** | Central query by `service=<SERVICE_NAME>` | Confirm `LOGGING_SERVICE_URL` and `LOGGING_SERVICE_API_PATH` in .env. First 30s after startup logs go only to stdout. Check stdout for "Logging service request timeout" or "Logging service failed". |
| **Old logs still visible after Clear all** | Server: `logsClearAllTimestamp` | Verify POST /api/clear-all is called (e.g. from UI). Response includes `clear_all_timestamp`. Reload "See logs…" after clear. After a successful **Run triage** or **Run all 50 emails**, only log lines from the latest run are returned per email. |
| **Classifier/Decider show rule-based with LLM selected** | See section 3 (log points). | Trace use_llm in AEPS server → ai_client → orchestrator → free-ai-service. Check orchestrator logs for "POINT OF FAILURE" and free-ai-service for OpenRouter 404. |

---

### 2.8 Env vars that affect logging (AEPS)

| Variable | Default | Effect |
|----------|---------|--------|
| `LOG_DIR` | `logs` | Directory for `run.log` (relative to process cwd or absolute). |
| `SERVICE_NAME` | `agentic-email-processing-system` | Sent in every log (central + file); used in central query as `service=` (e.g. `aeps-service` if you set it). |
| `LOGGING_SERVICE_URL` | (empty) | Base URL of logging microservice. If empty, central POST is skipped; logs API uses only in-memory when `?source=memory` or no URL. |
| `LOGGING_SERVICE_API_PATH` | `/api/logs` | Path for POST (e.g. `/api/logs`). Central **query** is always `GET <base>/api/logs/query?service=...&limit=...`. |
| `LOGS_CENTRAL_TIMEOUT_MS` | `4000` | Timeout for central query (clamped 2000–10000 ms). |

---

### 2.9 Summary table — Where to look for AEPS logs

| Location | How to access | Contains |
|----------|----------------|----------|
| **UI "See logs…"** | Open email → "See logs…" | In-memory + merged central, filtered by Clear-all time |
| **API per-email** | `GET /api/emails/<id>/logs` or `?source=memory` | Same as UI; optional `?limit=300` |
| **Local file** | `tail -f logs/run.log` (or `$LOG_DIR/run.log`) | All pushRunLog entries (JSON lines) |
| **Central logging** | Logging UI or `GET <LOGGING_SERVICE_URL>/api/logs/query?service=<SERVICE_NAME>&limit=300` | All logger.info/error/emitEvent from AEPS |
| **Stdout** | `docker logs -f <container>` or process terminal | Same as central during grace period or on central failure |

---

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

---

## 4. Clear all, Clear, Run triage, and log filtering

- **Clear all** clears in-memory run logs for every email and sets **logsClearAllTimestamp** to the current time.
- **Single-email Clear** clears that email’s in-memory run log and sets a per-email “since” timestamp to the clear time.
- **Run triage** (Run one) and **Run all 50 emails** both reset that email’s in-memory run log and set the per-email “since” timestamp to the run start time.
- **GET /api/emails/:message_id/logs** returns only entries with `timestamp >= max(logsClearAllTimestamp, email_logs_since[message_id])` (for both in-memory and central merge). So after Clear all or a new run, **no old logs** are shown in the UI or API for that email.

---

## 5. Browser and canonical URL

- **Use the canonical app URL:** `https://aeps.alfares.cz/`
- The long hostname `agentic-email-processing-system.alfares.cz` is **not** configured in nginx for this app; API calls there return **HTTP 404**, so the email list shows "Failed to load" and Run all shows an alert. Use **aeps.alfares.cz** for full UI and API.

---

## 6. Quick verification

1. Open **<https://aeps.alfares.cz/>** (not the long hostname).
2. Set Classifier and Decider to **AI (LLM)** in the UI.
3. Run one email or Run all 50.
4. In "See logs…" for an email, confirm:
   - `Stage completed: classify — model: <OpenRouter model>` (e.g. `openai/gpt-oss-20b:free` or `google/gemini-2.0-flash-exp:free`).
   - `Stage completed: decide — model: <OpenRouter model>`.
5. If you see `model: rule-based` or a 503/ERROR, follow the log points above and the troubleshooting section below.

---

## 7. Troubleshooting: "LLM requested but classifier/decider returned rule-based"

This error means the UI sent `use_llm: true` but the ai-orchestrator either had **FREE_AI_SERVICE_URL** unset or the call to free-ai-service failed (timeout, 5xx, or exception), so it fell back to rule-based and AEPS/ai-orchestrator then report the mismatch.

1. **If free-ai-service logs show OpenRouter 404/402**  
2  - free-ai-service tries **openrouter/free** first (router that auto-selects a free model); then specific free/paid models.  
