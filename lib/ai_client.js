/**
 * Client for email-triage agents running in ai-microservice.
 * Calls AI_SERVICE_URL/api/email-triage/ingest, classify, extract, decide.
 * Uses undici fetch with explicit connectTimeout when available so connect phase matches total timeout
 * (Node fetch has a separate 10s default connect timeout; without this, second request often times out).
 */

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || '';
const TIMEOUT_MS = 15000;
// Ingest is rule-based only; 5s timeout, no retry
const INGEST_TIMEOUT_MS = Math.min(10000, Math.max(1000, parseInt(process.env.AI_INGEST_TIMEOUT_MS || '5000', 10) || 5000));

let fetchFn = globalThis.fetch;
let defaultFetchOpts = {};
let ingestDispatcher = null;
try {
  const undici = require('undici');
  const aiDispatcher = new undici.Agent({ connectTimeout: TIMEOUT_MS });
  ingestDispatcher = new undici.Agent({ connectTimeout: INGEST_TIMEOUT_MS });
  fetchFn = undici.fetch;
  defaultFetchOpts = { dispatcher: aiDispatcher };
} catch (_) {
  // undici not installed (e.g. old image): use global fetch; connect timeout stays 10s default
}

const logger = require('../utils/logger');

/**
 * Classify fetch/request failure for logging: timeout, connectivity, or other.
 * @param {Error} err
 * @returns {'timeout'|'connectivity'|'other'}
 */
function getErrorReason(err) {
  const msg = (err && err.message) ? String(err.message).toLowerCase() : '';
  const cause = err && err.cause;
  const code = cause && cause.code;
  if (msg.includes('timeout') || err.name === 'TimeoutError' || code === 'ETIMEDOUT') return 'timeout';
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || msg.includes('unreachable') || msg.includes('fetch failed')) return 'connectivity';
  return 'other';
}

/**
 * Build a descriptive error for fetch failures (connection refused, ENOTFOUND, timeout).
 */
function wrapFetchError(err, url) {
  const cause = err.cause && err.cause.message ? err.cause.message : err.message;
  const msg = `AI service unreachable (${url}): ${cause}`;
  const e = new Error(msg);
  e.cause = err.cause || err;
  e.status = err.status;
  e.body = err.body;
  return e;
}

function isRetryableNetworkError(err) {
  const reason = getErrorReason(err);
  return reason === 'timeout' || reason === 'connectivity';
}

function isIngestPath(path) {
  return path === '/api/email-triage/ingest';
}

function isClassifyOrDecidePath(path) {
  return path === '/api/email-triage/classify' || path === '/api/email-triage/decide';
}

async function callAiService(path, body, attempt = 1) {
  if (!AI_SERVICE_URL) {
    throw new Error('AI_SERVICE_URL is not set');
  }
  if (isClassifyOrDecidePath(path) && body && typeof body === 'object') {
    logger.info('AI client sending use_llm (use_llm flow)', { path, use_llm: body.use_llm, use_llm_type: typeof body.use_llm, body_has_use_llm: 'use_llm' in body });
  }
  const base = AI_SERVICE_URL.replace(/\/$/, '');
  const url = `${base}${path}`;
  const useIngestTimeout = isIngestPath(path);
  const timeoutMs = useIngestTimeout ? INGEST_TIMEOUT_MS : TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  };
  if (useIngestTimeout && ingestDispatcher) {
    opts.dispatcher = ingestDispatcher;
  } else {
    Object.assign(opts, defaultFetchOpts);
  }
  const startedAt = Date.now();
  let res;
  try {
    res = await fetchFn(url, opts);
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const reason = getErrorReason(err);
    const causeCode = err.cause && err.cause.code;
    const retryable = !useIngestTimeout && isRetryableNetworkError(err) && attempt === 1;
    logger.error('AI service request failed', { path, reason, url, error: err.message, cause_code: causeCode || undefined, attempt, retry: retryable, elapsed_ms: elapsedMs });
    if (retryable) {
      logger.error('AI service request retrying once', { path, url });
      return callAiService(path, body, 2);
    }
    throw wrapFetchError(err, url);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || data.error || `AI service ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  if (isClassifyOrDecidePath(path) && data && typeof data === 'object') {
    logger.info('AI client received model_used (use_llm flow)', { path, model_used: data.model_used, model_used_type: typeof data.model_used });
  }
  return data;
}

/**
 * Ingest: validate and normalize. Returns { success, payload } or { success: false, error, escalation_reason }.
 * Requires AI_SERVICE_URL; no fallback — failures are logged as error and thrown.
 */
async function ingest(raw) {
  if (!AI_SERVICE_URL || !AI_SERVICE_URL.trim()) {
    const msg = 'AI_SERVICE_URL is not set; cannot call ingest (no fallback)';
    logger.error(msg, { path: '/api/email-triage/ingest' });
    throw new Error(msg);
  }
  try {
    return await callAiService('/api/email-triage/ingest', raw);
  } catch (err) {
    const reason = getErrorReason(err);
    const causeCode = err.cause && err.cause.code;
    logger.error('Ingest failed: AI service unreachable', { reason, path: '/api/email-triage/ingest', error: err.message, cause_code: causeCode || undefined });
    if (reason === 'timeout' || reason === 'connectivity') {
      const causeHint = causeCode ? `cause_code=${causeCode}. ` : '';
      const hint = ` (${causeHint}From host use AI_SERVICE_URL=http://localhost:3380; in Docker ensure ai-microservice is on nginx-network.)`;
      const e = wrapFetchError(err, AI_SERVICE_URL.replace(/\/$/, '') + '/api/email-triage/ingest');
      e.message = e.message + hint;
      throw e;
    }
    throw err;
  }
}

/**
 * Classify: intent + confidence. Body: { payload } or direct fields. Returns { success, intent, confidence, raw_scores }.
 * Requires AI_SERVICE_URL; no fallback — failures are logged as error and thrown.
 */
async function classify(body) {
  if (!AI_SERVICE_URL || !AI_SERVICE_URL.trim()) {
    const msg = 'AI_SERVICE_URL is not set; cannot call classify (no fallback)';
    logger.error(msg, { path: '/api/email-triage/classify' });
    throw new Error(msg);
  }
  try {
    logger.info('Classify call (body.use_llm)', { use_llm: body.use_llm, point: 'ai_client_classify_before_call' });
    const data = await callAiService('/api/email-triage/classify', body);
    logger.info('Classify response (model_used)', { model_used: data.model_used, point: 'ai_client_classify_after_call' });
    return data;
  } catch (err) {
    const reason = getErrorReason(err);
    logger.error('Classify failed: AI service unreachable', { reason, path: '/api/email-triage/classify', error: err.message, use_llm_sent: body.use_llm });
    throw err;
  }
}

/**
 * Extract: entities from normalized payload. Body: { payload, intent? }. Returns { success, message_id, entities, summary? }.
 * Requires AI_SERVICE_URL; no fallback — failures are logged as error and thrown.
 */
async function extract(body) {
  if (!AI_SERVICE_URL || !AI_SERVICE_URL.trim()) {
    const msg = 'AI_SERVICE_URL is not set; cannot call extract (no fallback)';
    logger.error(msg, { path: '/api/email-triage/extract' });
    throw new Error(msg);
  }
  try {
    return await callAiService('/api/email-triage/extract', body);
  } catch (err) {
    const reason = getErrorReason(err);
    logger.error('Extract failed: AI service unreachable', { reason, path: '/api/email-triage/extract', error: err.message });
    throw err;
  }
}

/**
 * Decide: action from intent + confidence. Body: { intent, confidence, entities? }. Returns { success, action, escalation_reason?, queue? }.
 * Requires AI_SERVICE_URL; no fallback — failures are logged as error and thrown.
 */
async function decide(body) {
  if (!AI_SERVICE_URL || !AI_SERVICE_URL.trim()) {
    const msg = 'AI_SERVICE_URL is not set; cannot call decide (no fallback)';
    logger.error(msg, { path: '/api/email-triage/decide' });
    throw new Error(msg);
  }
  try {
    logger.info('Decide call (body.use_llm)', { use_llm: body.use_llm, point: 'ai_client_decide_before_call' });
    const data = await callAiService('/api/email-triage/decide', body);
    logger.info('Decide response (model_used)', { model_used: data.model_used, point: 'ai_client_decide_after_call' });
    return data;
  } catch (err) {
    const reason = getErrorReason(err);
    logger.error('Decide failed: AI service unreachable', { reason, path: '/api/email-triage/decide', error: err.message, use_llm_sent: body.use_llm });
    throw err;
  }
}

/**
 * Check AI service reachability (GET /health). Uses same fetch/dispatcher as other calls.
 * @returns {Promise<'ok'|'unreachable'|'not_configured'>}
 */
async function checkAiHealth() {
  if (!AI_SERVICE_URL || !AI_SERVICE_URL.trim()) return 'not_configured';
  const base = AI_SERVICE_URL.replace(/\/$/, '');
  const url = `${base}/health`;
  const timeoutMs = 3000;
  const signal = AbortSignal.timeout(timeoutMs);
  const opts = { method: 'GET', signal };
  if (defaultFetchOpts.dispatcher) opts.dispatcher = defaultFetchOpts.dispatcher;
  try {
    const res = await fetchFn(url, opts);
    return res.ok ? 'ok' : 'unreachable';
  } catch (err) {
    logger.error('AI health check failed', { url, error: err.message, reason: getErrorReason(err) });
    return 'unreachable';
  }
}

module.exports = { ingest, classify, extract, decide, callAiService, getErrorReason, checkAiHealth };
