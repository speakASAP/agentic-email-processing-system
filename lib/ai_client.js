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

const localIngest = require('./ingest');
const localClassifier = require('./classifier');
const logger = require('../utils/logger');

function textFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const parts = [];
  if (payload.subject) parts.push(String(payload.subject).trim());
  if (payload.body_plain) parts.push(String(payload.body_plain).trim());
  return parts.join(' ').trim();
}

// Local extract fallback (mirrors ai-microservice extractor-contract)
function localExtract(payload, intent) {
  const message_id = (payload && payload.message_id != null) ? String(payload.message_id).trim() : 'unknown';
  const text = textFromPayload(payload);
  const entities = { product_refs: [], amounts: [], dates: [], contract_refs: [] };
  const amountRe = /\b(\d+(?:[.,]\d{2})?)\s*(€|eur|euro|chf|usd|\$|kč|czk)?\b/gi;
  const dateRe = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b|\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/g;
  const contractRefRe = /\b(vertrag|contract|auftrag|order)\s*#?\s*([A-Z0-9-]+)\b/gi;
  const productRefRe = /\b(artikel|article|produkt|product)\s*#?\s*([A-Z0-9-]+)\b/gi;
  let m;
  while ((m = amountRe.exec(text)) !== null) {
    const value = parseFloat(m[1].replace(',', '.'));
    if (!Number.isNaN(value)) entities.amounts.push({ value, unit: (m[2] || '').toUpperCase() || null });
  }
  while ((m = dateRe.exec(text)) !== null) entities.dates.push(m[0]);
  while ((m = contractRefRe.exec(text)) !== null) entities.contract_refs.push(m[2]);
  while ((m = productRefRe.exec(text)) !== null) entities.product_refs.push(m[2]);
  const summaryParts = [];
  if (entities.amounts.length) summaryParts.push('amount reference');
  if (entities.contract_refs.length) summaryParts.push('contract reference');
  if (intent) summaryParts.push(`intent:${intent}`);
  const summary = summaryParts.length ? summaryParts.join('; ') : null;
  return { message_id, entities, summary };
}

// Local decide fallback (mirrors ai-microservice routing-rules)
function localDecide(intent, confidence, entities) {
  const threshold = localClassifier.getConfidenceThreshold();
  const autoRespond = (process.env.AUTO_RESPOND_ENABLED || '').toLowerCase() in ['1', 'true', 'yes'];
  if (intent === 'unknown' || intent === 'multi_intent') {
    return { action: 'escalate', escalation_reason: intent === 'unknown' ? 'ambiguous_intent' : 'multi_intent', queue: null };
  }
  if (confidence < threshold) {
    return { action: 'escalate', escalation_reason: 'low_confidence', queue: null };
  }
  if (intent === 'contract') {
    return { action: 'escalate', escalation_reason: 'contract_change', queue: null };
  }
  const queueByIntent = { support: 'support', sales: 'sales', technical: 'technical', billing: 'billing', spam: 'spam_review' };
  const queue = queueByIntent[intent] || 'support';
  if (autoRespond && intent === 'support' && confidence >= 0.85) {
    return { action: 'auto_respond', escalation_reason: null, queue: null };
  }
  return { action: 'route_to_queue', escalation_reason: null, queue };
}

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
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...fetchOpts
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
 * When AI service is unreachable (timeout/connection), falls back to local classifier so pipeline can complete.
 */
async function classify(body) {
  if (!AI_SERVICE_URL || !AI_SERVICE_URL.trim()) {
    logger.warn('Using local classify fallback (AI_SERVICE_URL not set)');
    const payload = body && body.payload ? body.payload : body;
    const text = textFromPayload(payload);
    const threshold = localClassifier.getConfidenceThreshold();
    const result = localClassifier.classify(text, threshold);
    return { success: true, intent: result.intent, confidence: result.confidence, raw_scores: result.raw_scores };
  }
  try {
    return await callAiService('/api/email-triage/classify', body);
  } catch (err) {
    const isNetworkError = !err.status || err.message.includes('unreachable') || err.message.includes('fetch failed') ||
      (err.cause && (err.cause.code === 'ECONNREFUSED' || err.cause.code === 'ENOTFOUND' || err.cause.code === 'ETIMEDOUT'));
    if (!isNetworkError) throw err;
    const reason = getErrorReason(err);
    logger.error('AI service unreachable, using local classify fallback', { reason, path: '/api/email-triage/classify', error: err.message });
    const payload = body && body.payload ? body.payload : body;
    const text = textFromPayload(payload);
    const threshold = localClassifier.getConfidenceThreshold();
    const result = localClassifier.classify(text, threshold);
    return { success: true, intent: result.intent, confidence: result.confidence, raw_scores: result.raw_scores };
  }
}

/**
 * Extract: entities from normalized payload. Body: { payload, intent? }. Returns { success, message_id, entities, summary? }.
 * When AI service is unreachable, falls back to local extract so pipeline can complete.
 */
async function extract(body) {
  if (!AI_SERVICE_URL || !AI_SERVICE_URL.trim()) {
    logger.warn('Using local extract fallback (AI_SERVICE_URL not set)');
    const payload = body && body.payload ? body.payload : body;
    const intent = body && body.intent ? body.intent : null;
    const result = localExtract(payload, intent);
    return { success: true, ...result };
  }
  try {
    return await callAiService('/api/email-triage/extract', body);
  } catch (err) {
    const isNetworkError = !err.status || err.message.includes('unreachable') || err.message.includes('fetch failed') ||
      (err.cause && (err.cause.code === 'ECONNREFUSED' || err.cause.code === 'ENOTFOUND' || err.cause.code === 'ETIMEDOUT'));
    if (!isNetworkError) throw err;
    const reason = getErrorReason(err);
    logger.error('AI service unreachable, using local extract fallback', { reason, path: '/api/email-triage/extract', error: err.message });
    const payload = body && body.payload ? body.payload : body;
    const intent = body && body.intent ? body.intent : null;
    const result = localExtract(payload, intent);
    return { success: true, ...result };
  }
}

/**
 * Decide: action from intent + confidence. Body: { intent, confidence, entities? }. Returns { success, action, escalation_reason?, queue? }.
 * When AI service is unreachable, falls back to local decide so pipeline can complete.
 */
async function decide(body) {
  if (!AI_SERVICE_URL || !AI_SERVICE_URL.trim()) {
    logger.warn('Using local decide fallback (AI_SERVICE_URL not set)');
    const intent = body && body.intent ? body.intent : null;
    const confidence = body && body.confidence != null ? Number(body.confidence) : 0;
    const entities = body && body.entities ? body.entities : null;
    const result = localDecide(intent, confidence, entities);
    return { success: true, ...result };
  }
  try {
    return await callAiService('/api/email-triage/decide', body);
  } catch (err) {
    const isNetworkError = !err.status || err.message.includes('unreachable') || err.message.includes('fetch failed') ||
      (err.cause && (err.cause.code === 'ECONNREFUSED' || err.cause.code === 'ENOTFOUND' || err.cause.code === 'ETIMEDOUT'));
    if (!isNetworkError) throw err;
    const reason = getErrorReason(err);
    logger.error('AI service unreachable, using local decide fallback', { reason, path: '/api/email-triage/decide', error: err.message });
    const intent = body && body.intent ? body.intent : null;
    const confidence = body && body.confidence != null ? Number(body.confidence) : 0;
    const entities = body && body.entities ? body.entities : null;
    const result = localDecide(intent, confidence, entities);
    return { success: true, ...result };
  }
}

module.exports = { ingest, classify, extract, decide, callAiService, getErrorReason };
