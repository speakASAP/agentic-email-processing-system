#!/usr/bin/env node
/**
 * Test all email-triage endpoints: Ingest → Classify → Extract → Decide, then full triage.
 * Verifies AEPS /health (AI and logging reachability) then exercises each endpoint and checks responses.
 * Usage: node scripts/test-email-triage-endpoints.js
 *   AEPS_URL defaults to http://localhost:3374
 * For direct AI service checks (health, ready, ingest): node scripts/check-ai-connectivity.js
 * Exit: 0 if all pass, 1 if any fail.
 */
require('dotenv').config();

const AEPS_URL = (process.env.AEPS_URL || 'http://localhost:3374').replace(/\/$/, '');
const TIMEOUT_MS = 30000;

const INTENT_TAXONOMY = ['support', 'sales', 'contract', 'technical', 'billing', 'spam', 'unknown', 'multi_intent'];
const ACTION_SET = ['auto_respond', 'route_to_queue', 'escalate'];

let fetchFn = globalThis.fetch;
let fetchOpts = { signal: AbortSignal.timeout(TIMEOUT_MS) };
try {
  const undici = require('undici');
  const dispatcher = new undici.Agent({ connectTimeout: TIMEOUT_MS });
  fetchFn = undici.fetch;
  fetchOpts = { signal: AbortSignal.timeout(TIMEOUT_MS), dispatcher };
} catch (_) {}

const RAW_EMAIL = {
  message_id: 'test-endpoints-' + Date.now(),
  tenant_id: 'test-tenant',
  timestamp: new Date().toISOString(),
  sender: 'test@example.com',
  recipients: ['support@example.com'],
  subject: 'Unable to access my dashboard',
  body_plain: 'Hi, I logged in but my dashboard is empty. Can you check? Thanks.',
  attachments: []
};

let passed = 0;
let failed = 0;

function ok(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('  OK   ' + name + (detail ? ' — ' + detail : ''));
    return true;
  }
  failed++;
  console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  return false;
}

async function get(path) {
  const opts = { method: 'GET' };
  if (fetchOpts.dispatcher) opts.dispatcher = fetchOpts.dispatcher;
  opts.signal = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetchFn(AEPS_URL + path, opts);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {}
  return { status: res.status, json };
}

async function post(path, body) {
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  if (fetchOpts.dispatcher) opts.dispatcher = fetchOpts.dispatcher;
  opts.signal = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetchFn(AEPS_URL + path, opts);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {}
  return { status: res.status, json };
}

async function main() {
  console.log('Testing email-triage endpoints at ' + AEPS_URL);
  console.log('');

  // 0. Health (AI and logging reachability from AEPS)
  console.log('0. GET /health (AI LLM service and logging reachability)');
  let healthRes;
  try {
    healthRes = await get('/health');
  } catch (e) {
    ok('Health request', false, e.message || 'request failed');
    healthRes = null;
  }
  if (healthRes) {
    ok('Health HTTP 200', healthRes.status === 200, 'status=' + healthRes.status);
    const ai = healthRes.json && healthRes.json.ai;
    const logging = healthRes.json && healthRes.json.logging;
    ok('AI reachable', ai === 'ok', ai || 'not_configured');
    // Logging is optional for pipeline; warn only so tests pass when logging service is down
    if (logging === 'ok') {
      passed++;
      console.log('  OK   Logging reachable — ok');
    } else {
      console.log('  NOTE Logging reachable — ' + (logging || 'not_configured') + ' (optional for pipeline)');
    }
    if (ai !== 'ok') {
      console.log('  NOTE: If AI is not ok, set AI_SERVICE_URL and run: node scripts/check-ai-connectivity.js');
    }
  }

  // 1. Ingest
  console.log('');
  console.log('1. POST /api/ingest');
  let ingestRes;
  try {
    ingestRes = await post('/api/ingest', RAW_EMAIL);
  } catch (e) {
    ok('Ingest', false, e.message || 'request failed');
    ingestRes = null;
  }
  if (ingestRes) {
    ok('Ingest HTTP 200', ingestRes.status === 200, 'status=' + ingestRes.status);
    ok('Ingest success', ingestRes.json && ingestRes.json.success === true, ingestRes.json && ingestRes.json.error ? ingestRes.json.error : '');
    ok('Ingest payload', ingestRes.json && ingestRes.json.payload && typeof ingestRes.json.payload.message_id === 'string', '');
  }

  const payload = (ingestRes && ingestRes.json && ingestRes.json.payload) ? ingestRes.json.payload : RAW_EMAIL;

  // 2. Classify
  console.log('');
  console.log('2. POST /api/classify');
  let classifyRes;
  try {
    classifyRes = await post('/api/classify', { payload });
  } catch (e) {
    ok('Classify', false, e.message || 'request failed');
    classifyRes = null;
  }
  if (classifyRes) {
    ok('Classify HTTP 200', classifyRes.status === 200, 'status=' + classifyRes.status);
    ok('Classify success', classifyRes.json && classifyRes.json.success === true, '');
    ok('Classify intent', classifyRes.json && typeof classifyRes.json.intent === 'string', classifyRes.json && classifyRes.json.intent);
    ok('Classify confidence', classifyRes.json && typeof classifyRes.json.confidence === 'number', '');
    if (classifyRes.json && classifyRes.json.intent) {
      ok('Classify intent taxonomy', INTENT_TAXONOMY.includes(classifyRes.json.intent), classifyRes.json.intent);
    }
  }

  const intent = (classifyRes && classifyRes.json && classifyRes.json.intent) ? classifyRes.json.intent : 'support';
  const confidence = (classifyRes && classifyRes.json && typeof classifyRes.json.confidence === 'number') ? classifyRes.json.confidence : 0.9;

  // 3. Extract
  console.log('');
  console.log('3. POST /api/extract');
  let extractRes;
  try {
    extractRes = await post('/api/extract', { payload, intent });
  } catch (e) {
    ok('Extract', false, e.message || 'request failed');
    extractRes = null;
  }
  if (extractRes) {
    ok('Extract HTTP 200', extractRes.status === 200, 'status=' + extractRes.status);
    ok('Extract success', extractRes.json && extractRes.json.success === true, '');
    ok('Extract entities', extractRes.json && typeof extractRes.json.entities === 'object', '');
  }

  const entities = (extractRes && extractRes.json && extractRes.json.entities) ? extractRes.json.entities : {};

  // 4. Decide
  console.log('');
  console.log('4. POST /api/decide');
  let decideRes;
  try {
    decideRes = await post('/api/decide', {
      message_id: payload.message_id,
      tenant_id: payload.tenant_id,
      intent,
      confidence,
      entities
    });
  } catch (e) {
    ok('Decide', false, e.message || 'request failed');
    decideRes = null;
  }
  if (decideRes) {
    ok('Decide HTTP 200', decideRes.status === 200, 'status=' + decideRes.status);
    ok('Decide success', decideRes.json && decideRes.json.success === true, '');
    ok('Decide action', decideRes.json && typeof decideRes.json.action === 'string', decideRes.json && decideRes.json.action);
    if (decideRes.json && decideRes.json.action) {
      ok('Decide action set', ACTION_SET.includes(decideRes.json.action), decideRes.json.action);
    }
  }

  // 5. Full pipeline (POST /api/triage) — retry once on 503 (transient AI/network)
  console.log('');
  console.log('5. POST /api/triage (full pipeline)');
  let triageRes;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      triageRes = await post('/api/triage', RAW_EMAIL);
      if (triageRes.status === 200) break;
      if (triageRes.status === 503 && attempt < 2) {
        console.log('  NOTE Triage returned 503, retrying once...');
        continue;
      }
      break;
    } catch (e) {
      if (attempt < 2) {
        console.log('  NOTE Triage request failed, retrying once...');
        continue;
      }
      ok('Triage', false, e.message || 'request failed');
      triageRes = null;
    }
  }
  if (triageRes) {
    ok('Triage HTTP 200', triageRes.status === 200, 'status=' + triageRes.status);
    ok('Triage success', triageRes.json && triageRes.json.success === true, '');
    ok('Triage intent', triageRes.json && typeof triageRes.json.intent === 'string', triageRes.json && triageRes.json.intent);
    ok('Triage action', triageRes.json && typeof triageRes.json.action === 'string', triageRes.json && triageRes.json.action);
    if (triageRes.json && triageRes.json.action) {
      ok('Triage action set', ACTION_SET.includes(triageRes.json.action), triageRes.json.action);
    }
  }

  console.log('');
  console.log('---');
  console.log('Result: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
