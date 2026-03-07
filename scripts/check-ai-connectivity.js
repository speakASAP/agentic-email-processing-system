#!/usr/bin/env node
/**
 * Diagnostic: connect to AI_SERVICE_URL (health + ingest) and report result.
 * Usage: node scripts/check-ai-connectivity.js
 * From host: set AI_SERVICE_URL=http://localhost:3380 if orchestrator is port-mapped.
 * From container: AI_SERVICE_URL=http://ai-microservice:3380 (default in .env).
 */
require('dotenv').config();

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-microservice:3380';
const TIMEOUT_MS = 15000;

let fetchFn = globalThis.fetch;
let fetchOpts = { signal: AbortSignal.timeout(TIMEOUT_MS) };
try {
  const undici = require('undici');
  const dispatcher = new undici.Agent({ connectTimeout: TIMEOUT_MS });
  fetchFn = undici.fetch;
  fetchOpts = { signal: AbortSignal.timeout(TIMEOUT_MS), dispatcher };
} catch (_) {
  console.log('(undici not found, using global fetch)');
}

const base = AI_SERVICE_URL.replace(/\/$/, '');

function formatErr(e) {
  const code = e.cause && e.cause.code;
  const msg = e.message || String(e);
  return { code: code || 'unknown', message: msg };
}

async function main() {
  console.log('AI_SERVICE_URL:', AI_SERVICE_URL);
  console.log('Timeout:', TIMEOUT_MS, 'ms');
  console.log('');

  const t0 = Date.now();

  // 1. GET /health
  try {
    const healthUrl = `${base}/health`;
    console.log('1. GET', healthUrl);
    const res = await fetchFn(healthUrl, fetchOpts);
    const elapsed = Date.now() - t0;
    const text = await res.text();
    console.log('   Status:', res.status, '| Elapsed:', elapsed, 'ms');
    if (res.ok) {
      console.log('   Body (first 200 chars):', text.slice(0, 200));
    } else {
      console.log('   Body:', text.slice(0, 300));
    }
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.log('   ERROR after', elapsed, 'ms:', formatErr(err));
    console.log('   Full error:', err.message);
    if (err.cause) console.log('   Cause:', err.cause.message || err.cause.code);
    process.exitCode = 1;
    return;
  }

  console.log('');

  // 2. POST /api/email-triage/ingest (minimal payload)
  const ingestPayload = {
    message_id: 'connectivity-check',
    tenant_id: 'diagnostic',
    timestamp: new Date().toISOString(),
    sender: 'check@local',
    recipients: ['support@local'],
    subject: 'Connectivity test',
    body_plain: 'Test body',
    attachments: [],
  };
  const ingestUrl = `${base}/api/email-triage/ingest`;
  console.log('2. POST', ingestUrl);
  const t1 = Date.now();
  try {
    const res = await fetchFn(ingestUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ingestPayload),
      ...fetchOpts,
    });
    const elapsed = Date.now() - t1;
    const data = await res.json().catch(() => ({}));
    console.log('   Status:', res.status, '| Elapsed:', elapsed, 'ms');
    if (res.ok) {
      console.log('   Response:', JSON.stringify(data).slice(0, 300));
    } else {
      console.log('   Error response:', JSON.stringify(data));
    }
  } catch (err) {
    const elapsed = Date.now() - t1;
    console.log('   ERROR after', elapsed, 'ms:', formatErr(err));
    console.log('   Full error:', err.message);
    if (err.cause) console.log('   Cause:', err.cause.message || err.cause.code);
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('All checks passed.');
}

main().catch((e) => {
  console.error('Uncaught:', e);
  process.exitCode = 1;
});
