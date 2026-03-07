/**
 * Client for email-triage agents running in ai-microservice.
 * Calls AI_SERVICE_URL/api/email-triage/ingest, classify, extract, decide.
 * Uses undici fetch with explicit connectTimeout so connect phase matches total timeout
 * (Node fetch has a separate 10s default connect timeout; without this, second request often times out).
 */

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || '';
const TIMEOUT_MS = 15000;

const { fetch: undiciFetch, Agent } = require('undici');
const aiDispatcher = new Agent({ connectTimeout: TIMEOUT_MS });

const localIngest = require('./ingest');
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

async function callAiService(path, body) {
  if (!AI_SERVICE_URL) {
    throw new Error('AI_SERVICE_URL is not set');
  }
  const base = AI_SERVICE_URL.replace(/\/$/, '');
  const url = `${base}${path}`;
  let res;
  try {
    res = await undiciFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      dispatcher: aiDispatcher
    });
  } catch (err) {
    const reason = getErrorReason(err);
    logger.error('AI service request failed', { path, reason, url, error: err.message });
    throw wrapFetchError(err, url);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || data.error || `AI service ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * Ingest: validate and normalize. Returns { success, payload } or { success: false, error, escalation_reason }.
 * When AI_SERVICE_URL is unset or unreachable, falls back to local validateAndNormalize so demo can complete ingest.
 */
async function ingest(raw) {
  if (!AI_SERVICE_URL || !AI_SERVICE_URL.trim()) {
    logger.warn('Using local ingest fallback (AI_SERVICE_URL not set)');
    const result = localIngest.validateAndNormalize(raw);
    if (result.valid) return { success: true, payload: result.normalized };
    return { success: false, error: result.error, escalation_reason: result.escalation_reason || 'incomplete_data' };
  }
  try {
    return await callAiService('/api/email-triage/ingest', raw);
  } catch (err) {
    const isNetworkError = !err.status || err.message.includes('unreachable') || err.message.includes('fetch failed') ||
      (err.cause && (err.cause.code === 'ECONNREFUSED' || err.cause.code === 'ENOTFOUND' || err.cause.code === 'ETIMEDOUT'));
    if (!isNetworkError) throw err;
    const reason = getErrorReason(err);
    logger.error('AI service unreachable, using local ingest fallback', { reason, path: '/api/email-triage/ingest', error: err.message });
    const result = localIngest.validateAndNormalize(raw);
    if (result.valid) {
      return { success: true, payload: result.normalized };
    }
    return { success: false, error: result.error, escalation_reason: result.escalation_reason || 'incomplete_data' };
  }
}

/**
 * Classify: intent + confidence. Body: { payload } or direct fields. Returns { success, intent, confidence, raw_scores }.
 */
async function classify(body) {
  return callAiService('/api/email-triage/classify', body);
}

/**
 * Extract: entities from normalized payload. Body: { payload, intent? }. Returns { success, message_id, entities, summary? }.
 */
async function extract(body) {
  return callAiService('/api/email-triage/extract', body);
}

/**
 * Decide: action from intent + confidence. Body: { intent, confidence, entities? }. Returns { success, action, escalation_reason?, queue? }.
 */
async function decide(body) {
  return callAiService('/api/email-triage/decide', body);
}

module.exports = { ingest, classify, extract, decide, callAiService, getErrorReason };
