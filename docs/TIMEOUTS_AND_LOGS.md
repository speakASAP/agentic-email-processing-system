# Timeouts and logs (email-triage path)

## Timeouts

### agentic-email-processing-system (client calling AI)

| Location | Value | Description |
|----------|--------|-------------|
| `lib/ai_client.js` | **15 000 ms (15 s)** | Total request timeout for classify, extract, decide. `AbortSignal.timeout(TIMEOUT_MS)` and undici `connectTimeout: TIMEOUT_MS`. |
| `lib/ai_client.js` | **5 000 ms (5 s)** | Ingest timeout (`AI_INGEST_TIMEOUT_MS`, env-overridable). Ingest is rule-based only; short timeout is intentional. |
| `lib/ai_client.js` | (undici missing) | If undici is not installed, global `fetch` is used; connect phase can use ~10 s default. |
| `server.js` | 10 000 ms | Fetch for logs query URL. |
| `server.js` | 3 000 ms | Health check (LOGGING_SERVICE_URL and AI_SERVICE_URL). |
| `utils/logger.js` | 2 000 ms | Logging service request. |

So **ingest times out after 5 seconds** if the AI service does not respond. On failure, logs include `cause_code` (e.g. `ETIMEDOUT`, `ECONNREFUSED`, `ENOTFOUND`) to distinguish connection vs timeout. From host use `AI_SERVICE_URL=http://localhost:3380`; in Docker ensure ai-microservice is on the same network (e.g. nginx-network) with alias `ai-microservice`.

### ai-microservice (orchestrator serving email-triage)

- **No application-level timeout** for incoming HTTP requests to `/api/email-triage/*`. Uvicorn/Starlette handle the request until the handler returns.
- Email-triage handlers run sync work in `asyncio.to_thread()` (ingest/classify/extract/decide); they do not set a per-request timeout.
- Outgoing HTTP from the orchestrator (e.g. shop-assistant, models) use various httpx timeouts (5 s–180 s depending on endpoint); these do not apply to the email-triage path, which is CPU-only (regex/validation).

So the **time limit is on the client (agentic-email)**. If the request never reaches the orchestrator or the response is slow, the client aborts (ingest after 5 s, other AI calls after 15 s).

---

## Where to check logs (ai-microservice)

1. **Console (stdout)**  
   If the container runs with logs attached:  
   `docker logs -f ai-microservice-orchestrator-green` (or `-blue`).

2. **Local file (when writable)**  
   `/app/logs/<service_name>.log` inside the container (or `./logs/` when not in container).  
   Service name is set in the orchestrator logger (e.g. `ai-orchestrator`).

3. **Central logging service**  
   Logs are sent to `LOGGING_SERVICE_URL` (e.g. `http://logging-microservice:3367`), path `LOGGING_SERVICE_API_PATH` (e.g. `/api/logs`).  
   Use your central log UI (e.g. <https://logging.alfares.cz>) and filter by service / message.

### Email-triage log messages (orchestrator)

When a request **reaches** the orchestrator you should see (from `main.py` and `email_triage_agents.py`):

- **Ingest**  
  - `Email-triage ingest request received` (message_id=…)  
  - then either `Email-triage ingest rejected` (…) or `Email-triage ingest success` (message_id=…, duration_ms=…)

- **Classify**  
  - `Email-triage Classifier: classify_payload started`  
  - `Email-triage Classifier: text for classification` (text_length=…)  
  - `Email-triage Classifier: keyword match counts and scores` (match_counts, raw_scores)  
  - then one of: `no keyword matches above baseline`, `below threshold - unknown`, `classified`, `multi_intent`, `tie broken by match count`

- **Extract**  
  - `Email-triage Extractor: extract_payload started`  
  - `Email-triage Extractor: extract_payload done` (…)

- **Decide**  
  - `Email-triage Decider: decide_action started`  
  - then one of: `escalate (intent)`, `escalate (low_confidence)`, `escalate (contract)`, `auto_respond`, `route_to_queue`

If you **do not** see `Email-triage ingest request received` when the client times out, the request is not reaching the orchestrator (network/DNS/firewall or wrong host/port). Check client logs for `cause_code`: `ENOTFOUND` = hostname does not resolve (e.g. `ai-microservice` from host — use `AI_SERVICE_URL=http://localhost:3380`); `ECONNREFUSED` = nothing listening on that host:port; `ETIMEDOUT` = connect or read took too long. If you **do** see `Email-triage ingest request received` and then a long delay before `Email-triage ingest success`, the hang is inside the orchestrator (ingest runs in a thread; next suspect is startup/lifespan or other middleware).

---

## Programmatic connectivity check

**From host (ai-microservice hostname does not resolve):**

- `ai-microservice` is a Docker network hostname. From your dev machine it will not resolve (you get `EAI_AGAIN` / `ENOTFOUND`).
- Use `AI_SERVICE_URL=http://localhost:3380` when running the script on the host if the orchestrator is port-mapped:

  ```bash
  cd agentic-email-processing-system && AI_SERVICE_URL=http://localhost:3380 node scripts/check-ai-connectivity.js
  ```

**From inside the agentic-email container (same network as orchestrator):**

- From inside the container, `http://ai-microservice:3380` does resolve and respond (health + ingest both succeed in tens of ms in tested setup).
- To re-run the diagnostic when a timeout occurs:

  ```bash
  docker exec agentic-email-processing-system-green node /app/scripts/check-ai-incontainer.js
  ```

**Summary of findings (when both containers are on `nginx-network`):**

- Orchestrator responds on `localhost:3380` (host) and on `ai-microservice:3380` (from agentic-email container).
- If you still see 15 s timeouts in the UI, run the in-container script at the time of failure to see whether the failure is timeout, ECONNREFUSED, or ENOTFOUND. If the script passes but triage still times out, the issue may be concurrency or a cold-start delay (e.g. first request after idle).
