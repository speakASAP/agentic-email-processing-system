/**
 * Client for email-triage agents running in ai-microservice.
 * Calls AI_SERVICE_URL/api/email-triage/ingest and /api/email-triage/classify.
 */

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || '';
const TIMEOUT_MS = 15000;

async function callAiService(path, body) {
  if (!AI_SERVICE_URL) {
    throw new Error('AI_SERVICE_URL is not set');
  }
  const base = AI_SERVICE_URL.replace(/\/$/, '');
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
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
 */
async function ingest(raw) {
  return callAiService('/api/email-triage/ingest', raw);
}

/**
 * Classify: intent + confidence. Body: { payload } or direct fields. Returns { success, intent, confidence, raw_scores }.
 */
async function classify(body) {
  return callAiService('/api/email-triage/classify', body);
}

module.exports = { ingest, classify, callAiService };
