/**
 * Client for email-triage agents running in ai-microservice.
 * Calls AI_SERVICE_URL/api/email-triage/ingest, classify, extract, decide.
 * Uses undici fetch with explicit connectTimeout when available so connect phase matches total timeout
 * (Node fetch has a separate 10s default connect timeout; without this, second request often times out).
 */

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || '';
const TIMEOUT_MS = 15000;

let fetchFn = globalThis.fetch;
let fetchOpts = { signal: AbortSignal.timeout(TIMEOUT_MS) };
try {
  const undici = require('undici');
  const aiDispatcher = new undici.Agent({ connectTimeout: TIMEOUT_MS });
  fetchFn = undici.fetch;
  fetchOpts = { signal: AbortSignal.timeout(TIMEOUT_MS), dispatcher: aiDispatcher };
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

async function callAiService(path, body, attempt = 1) {
  if (!AI_SERVICE_URL) {
    throw new Error('AI_SERVICE_URL is not set');
  }
  const base = AI_SERVICE_URL.replace(/\/$/, '');
  const url = `${base}${path}`;
  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...fetchOpts
    });
  } catch (err) {
    const reason = getErrorReason(err);
    const retryable = isRetryableNetworkError(err) && attempt === 1;
    logger.error('AI service request failed', { path, reason, url, error: err.message, attempt, retry: retryable });
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
    logger.error('Ingest failed: AI service unreachable', { reason, path: '/api/email-triage/ingest', error: err.message });
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
    return await callAiService('/api/email-triage/classify', body);
  } catch (err) {
    const reason = getErrorReason(err);
    logger.error('Classify failed: AI service unreachable', { reason, path: '/api/email-triage/classify', error: err.message });
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
    return await callAiService('/api/email-triage/decide', body);
  } catch (err) {
    const reason = getErrorReason(err);
    logger.error('Decide failed: AI service unreachable', { reason, path: '/api/email-triage/decide', error: err.message });
    throw err;
  }
}

module.exports = { ingest, classify, extract, decide, callAiService, getErrorReason };
