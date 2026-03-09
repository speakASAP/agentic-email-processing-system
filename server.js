/**
 * Agentic Email Processing System — Phase 1+3: Ingest, Classify, Extract, Decide, Act/Escalate.
 * Uses email-triage agents from ai-microservice (AI_SERVICE_URL).
 * Contracts: docs/contracts/ (email-schema, event-schema, intent-taxonomy, extractor, action-set, routing-rules).
 */

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const aiClient = require('./lib/ai_client');
const logger = require('./utils/logger');
const { runTriagePipeline } = require('./lib/triage_pipeline');
const emailDataset = require('./lib/email_dataset');

const app = express();

// CORS: allow same-domain (aeps.alfares.cz, *.alfares.cz, localhost) so no 403 for same-ecosystem requests
const CORS_ORIGIN_REGEX = /^https?:\/\/([a-z0-9-]+\.)?alfares\.cz$/;
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && (origin.startsWith('http://localhost') || origin.startsWith('https://localhost') || origin.startsWith('http://127.0.0.1') || origin.startsWith('https://127.0.0.1') || CORS_ORIGIN_REGEX.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3374;

// In-memory run log buffer per message_id (so "See logs..." shows progress even if LOGGING_SERVICE_URL is down)
const RUN_LOG_BUFFER_MAX = 100;
const runLogBuffer = new Map();
// Per-email "since" timestamp (Clear for this email or last triage run); used together with logsClearAllTimestamp.
const emailLogsSince = new Map();
// When Clear all was last clicked; logs API returns only entries with timestamp >= this (no old logs after clear-all).
let logsClearAllTimestamp = null;

// Applications directory: logs stored in 3 places — central service, in-memory, and local logs/ dir
const LOG_DIR = process.env.LOG_DIR || 'logs';
const RUN_LOG_FILE = 'run.log';

function getRunLogPath() {
  const dir = path.isAbsolute(LOG_DIR) ? LOG_DIR : path.join(__dirname, LOG_DIR);
  return path.join(dir, RUN_LOG_FILE);
}

function appendRunLogToFile(entry) {
  try {
    const filePath = getRunLogPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    logger.error('Failed to write run log to file', { error: err.message });
  }
}

function pushRunLog(message_id, level, message, metadata = {}) {
  const key = String(message_id);
  const entry = {
    level,
    message,
    service: process.env.SERVICE_NAME || 'agentic-email-processing-system',
    timestamp: new Date().toISOString(),
    metadata: { message_id: key, ...metadata }
  };
  if (!runLogBuffer.has(key)) runLogBuffer.set(key, []);
  const arr = runLogBuffer.get(key);
  arr.push(entry);
  if (arr.length > RUN_LOG_BUFFER_MAX) arr.shift();
  appendRunLogToFile(entry);
}

// Test dataset: load once at startup
emailDataset.ensureLoaded();
logger.info(`Test dataset loaded: ${emailDataset.getMessageIds().length} emails`);

// --- Ingest (proxies to ai-microservice) ---
app.post('/api/ingest', async (req, res) => {
  const ts = new Date().toISOString();
  const message_id = (req.body && req.body.message_id != null) ? String(req.body.message_id) : 'unknown';
  const tenant_id = (req.body && req.body.tenant_id != null) ? String(req.body.tenant_id) : '';

  try {
    const result = await aiClient.ingest(req.body || {});

    if (!result.success) {
      logger.emitEvent({
        message_id,
        timestamp: ts,
        agent: 'ingest',
        decision: 'rejected',
        confidence: null,
        escalation_reason: result.escalation_reason || 'incomplete_data',
        tenant_id,
        details: { error: result.error }
      });
      return res.status(400).json({
        success: false,
        error: result.error,
        escalation_reason: result.escalation_reason || 'incomplete_data'
      });
    }

    logger.emitEvent({
      message_id: result.payload.message_id,
      timestamp: ts,
      agent: 'ingest',
      decision: 'accepted',
      confidence: null,
      escalation_reason: null,
      tenant_id: result.payload.tenant_id
    });

    return res.status(200).json({ success: true, payload: result.payload });
  } catch (err) {
    const reason = aiClient.getErrorReason ? aiClient.getErrorReason(err) : 'other';
    logger.error(`Ingest error (ai-microservice): ${reason}`, { message_id, reason, error: err.message });
    logger.emitEvent({
      message_id,
      timestamp: ts,
      agent: 'ingest',
      decision: 'error',
      confidence: null,
      escalation_reason: err.status === 400 ? (err.body && err.body.escalation_reason) || 'incomplete_data' : null,
      tenant_id,
      details: { error: err.message }
    });
    const status = err.status === 400 ? 400 : 503;
    return res.status(status).json({
      success: false,
      error: err.status === 400 ? (err.body && err.body.error) || err.message : 'AI service unavailable',
      ...(status === 503 && err.message ? { details: { error: err.message } } : {})
    });
  }
});

// --- Classifier (proxies to ai-microservice) ---
app.post('/api/classify', async (req, res) => {
  const ts = new Date().toISOString();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const payload = body.payload || body;
  const message_id = payload.message_id != null ? String(payload.message_id) : 'unknown';
  const tenant_id = payload.tenant_id != null ? String(payload.tenant_id) : '';

  try {
    const result = await aiClient.classify(body);

    logger.emitEvent({
      message_id,
      timestamp: ts,
      agent: 'classifier',
      decision: result.intent,
      confidence: result.confidence,
      escalation_reason: null,
      tenant_id,
      intent: result.intent,
      details: result.raw_scores ? { raw_scores: result.raw_scores } : undefined
    });

    return res.status(200).json({
      success: true,
      intent: result.intent,
      confidence: result.confidence,
      raw_scores: result.raw_scores
    });
  } catch (err) {
    const reason = aiClient.getErrorReason ? aiClient.getErrorReason(err) : 'other';
    logger.error(`Classifier error (ai-microservice): ${reason}`, { message_id, reason, error: err.message });
    const escalationReason = err.status === 400 && err.body && err.body.escalation_reason
      ? err.body.escalation_reason
      : null;
    logger.emitEvent({
      message_id,
      timestamp: ts,
      agent: 'classifier',
      decision: 'error',
      confidence: null,
      escalation_reason: escalationReason,
      tenant_id,
      details: { error: err.message }
    });
    const status = err.status === 400 ? 400 : 503;
    return res.status(status).json({
      success: false,
      error: err.status === 400 ? (err.body && err.body.detail) || err.message : 'AI service unavailable'
    });
  }
});

// --- Extractor (proxies to ai-microservice) ---
app.post('/api/extract', async (req, res) => {
  const ts = new Date().toISOString();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const payload = body.payload || body;
  const message_id = payload && payload.message_id != null ? String(payload.message_id) : 'unknown';
  const tenant_id = payload && payload.tenant_id != null ? String(payload.tenant_id) : '';

  try {
    const result = await aiClient.extract(body);

    logger.emitEvent({
      message_id: result.message_id || message_id,
      timestamp: ts,
      agent: 'extractor',
      decision: 'extracted',
      confidence: null,
      escalation_reason: null,
      tenant_id,
      details: result.summary ? { summary: result.summary } : undefined
    });

    return res.status(200).json({
      success: true,
      message_id: result.message_id,
      entities: result.entities,
      summary: result.summary
    });
  } catch (err) {
    logger.error('Extractor error (ai-microservice)', { error: err.message });
    logger.emitEvent({
      message_id,
      timestamp: ts,
      agent: 'extractor',
      decision: 'error',
      confidence: null,
      escalation_reason: err.status === 400 ? (err.body && err.body.escalation_reason) || 'incomplete_data' : null,
      tenant_id,
      details: { error: err.message }
    });
    const status = err.status === 400 ? 400 : 503;
    return res.status(status).json({
      success: false,
      error: err.status === 400 ? (err.body && err.body.error) || err.message : 'AI service unavailable'
    });
  }
});

// --- Action/Decider (proxies to ai-microservice) ---
app.post('/api/decide', async (req, res) => {
  const ts = new Date().toISOString();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const message_id = body.message_id != null ? String(body.message_id) : 'unknown';
  const tenant_id = body.tenant_id != null ? String(body.tenant_id) : '';

  try {
    const result = await aiClient.decide(body);

    logger.emitEvent({
      message_id,
      timestamp: ts,
      agent: 'action_decider',
      decision: result.action,
      confidence: null,
      escalation_reason: result.escalation_reason || null,
      tenant_id,
      action: result.action,
      details: result.queue ? { queue: result.queue } : undefined
    });

    return res.status(200).json({
      success: true,
      action: result.action,
      escalation_reason: result.escalation_reason,
      queue: result.queue
    });
  } catch (err) {
    logger.error('Decider error (ai-microservice)', { error: err.message });
    const escalationReason = err.status === 400 && err.body && err.body.escalation_reason
      ? err.body.escalation_reason
      : null;
    logger.emitEvent({
      message_id,
      timestamp: ts,
      agent: 'action_decider',
      decision: 'error',
      confidence: null,
      escalation_reason: escalationReason,
      tenant_id,
      details: { error: err.message }
    });
    const status = err.status === 400 ? 400 : 503;
    return res.status(status).json({
      success: false,
      error: err.status === 400 ? (err.body && err.body.error) || err.message : 'AI service unavailable'
    });
  }
});

// --- Phase 3: End-to-end triage pipeline (ingest → classify → extract → decide → act) ---
app.post('/api/triage', async (req, res) => {
  const raw = req.body || {};
  try {
    const result = await runTriagePipeline(raw, aiClient, logger);
    if (!result.success) {
      const status = result.step === 'ingest' && result.escalation_reason ? 400 : 503;
      return res.status(status).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    logger.error('Triage pipeline error', { error: err.message });
    return res.status(503).json({
      success: false,
      step: 'ingest',
      error: err.message || 'AI service unavailable'
    });
  }
});

// --- App API: test dataset (50 emails) and per-email workflow state ---
// In-memory analysis mode: user can switch AI (LLM) vs rule-based for Classifier and Decider
let analysisMode = { useLlmClassifier: false, useLlmDecider: false };

function getSettings() {
  return { useLlmClassifier: analysisMode.useLlmClassifier, useLlmDecider: analysisMode.useLlmDecider };
}

app.get('/api/settings', (req, res) => {
  res.json(getSettings());
});

function coerceBool(value) {
  if (value === true || value === 1 || value === 'true' || value === '1' || value === 'yes') return true;
  if (value === false || value === 0 || value === 'false' || value === '0' || value === 'no' || value === '') return false;
  return undefined;
}
app.put('/api/settings', (req, res) => {
  const body = req.body || {};
  const c = coerceBool(body.useLlmClassifier);
  const d = coerceBool(body.useLlmDecider);
  if (c !== undefined) analysisMode.useLlmClassifier = c;
  if (d !== undefined) analysisMode.useLlmDecider = d;
  logger.info('Settings updated', getSettings());
  res.json(getSettings());
});

app.get('/api/emails', (req, res) => {
  emailDataset.ensureLoaded();
  const list = emailDataset.getList();
  res.json({ emails: list });
});

app.get('/api/emails/:message_id', (req, res) => {
  emailDataset.ensureLoaded();
  const rec = emailDataset.get(req.params.message_id);
  if (!rec) return res.status(404).json({ error: 'Email not found' });
  res.json(rec);
});

// Fetch logs for this email (message_id) from central logging service for "See logs..." in GUI
// Query: ?source=memory = return only in-memory logs immediately (no central fetch). Omit for merged logs.
const LOGS_CENTRAL_TIMEOUT_MS = Math.min(10000, Math.max(2000, parseInt(process.env.LOGS_CENTRAL_TIMEOUT_MS || '4000', 10) || 4000));

app.get('/api/emails/:message_id/logs', async (req, res) => {
  emailDataset.ensureLoaded();
  const message_id = req.params.message_id;
  const rec = emailDataset.get(message_id);
  if (!rec) return res.status(404).json({ error: 'Email not found' });

  const LOGGING_SERVICE_URL = process.env.LOGGING_SERVICE_URL || '';
  const SERVICE_NAME = process.env.SERVICE_NAME || 'agentic-email-processing-system';
  const limit = Math.min(Number(req.query.limit) || 300, 500);
  const sourceMemoryOnly = (req.query.source || '').toLowerCase() === 'memory';

  const inMemory = runLogBuffer.get(String(message_id)) || [];
  const emailSince = emailLogsSince.get(String(message_id)) || '';
  const since = logsClearAllTimestamp && emailSince
    ? (emailSince > logsClearAllTimestamp ? emailSince : logsClearAllTimestamp)
    : (emailSince || logsClearAllTimestamp || '');
  const filterSince = (arr) => (since ? arr.filter((e) => (e.timestamp || '') >= since) : arr);
  const sortedMemory = filterSince([...inMemory].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || '')));

  if (sourceMemoryOnly || !LOGGING_SERVICE_URL) {
    const message = sourceMemoryOnly ? undefined : 'Logging service not configured; showing in-memory progress only';
    return res.json({ logs: sortedMemory, message });
  }

  const base = LOGGING_SERVICE_URL.replace(/\/$/, '');
  const queryUrl = `${base}/api/logs/query?service=${encodeURIComponent(SERVICE_NAME)}&limit=${limit}`;
  try {
    const response = await fetch(queryUrl, { signal: AbortSignal.timeout(LOGS_CENTRAL_TIMEOUT_MS) });
    if (!response.ok) {
      logger.error('Logs query failed', { status: response.status, message_id });
      const merged = filterSince([...inMemory].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || '')));
      return res.json({ logs: merged, error: `Logging service returned ${response.status}` });
    }
    const data = await response.json();
    const all = (data && data.data && Array.isArray(data.data)) ? data.data : [];
    const fromService = filterSince(
      all
        .filter((entry) => {
          const meta = entry.metadata || {};
          return String(meta.message_id || '') === String(message_id);
        })
        .map((entry) => ({
          timestamp: entry.timestamp || entry.ts,
          level: entry.level || entry.severity || 'info',
          message: entry.message || entry.msg || '',
          metadata: entry.metadata || {}
        }))
    );
    const merged = filterSince([...inMemory, ...fromService].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || '')));
    return res.json({ logs: merged });
  } catch (err) {
    const reason = aiClient.getErrorReason ? aiClient.getErrorReason(err) : 'other';
    logger.error(`Logs fetch error: ${reason}`, { message_id, reason, error: err.message });
    const merged = filterSince([...inMemory].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || '')));
    return res.json({ logs: merged, error: err.message || 'Failed to fetch logs' });
  }
});

app.put('/api/emails/:message_id', (req, res) => {
  emailDataset.ensureLoaded();
  const message_id = req.params.message_id;
  const rec = emailDataset.get(message_id);
  if (!rec) return res.status(404).json({ error: 'Email not found' });
  const payload = req.body && req.body.email ? req.body.email : req.body;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Body must include email payload (e.g. { email: { subject, sender, body_plain } })' });
  }
  const ok = emailDataset.updateEmail(message_id, payload);
  if (!ok) return res.status(400).json({ error: 'Update failed' });
  logger.info('Email updated', { message_id });
  res.json({ ok: true, message_id });
});

app.post('/api/emails/:message_id/clear', (req, res) => {
  emailDataset.ensureLoaded();
  const message_id = req.params.message_id;
  const rec = emailDataset.get(message_id);
  if (!rec) return res.status(404).json({ error: 'Email not found' });
  emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_PENDING);
  for (const stage of emailDataset.STAGES) {
    emailDataset.setStageResult(message_id, stage, 'pending', {});
  }
  runLogBuffer.delete(String(message_id));
  emailLogsSince.set(String(message_id), new Date().toISOString());
  logger.info('Results and run logs cleared', { message_id });
  res.json({ ok: true, message_id });
});

app.post('/api/clear-all', (req, res) => {
  emailDataset.ensureLoaded();
  const ids = emailDataset.getMessageIds();
  const clearAt = new Date().toISOString();
  for (const message_id of ids) {
    emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_PENDING);
    for (const stage of emailDataset.STAGES) {
      emailDataset.setStageResult(message_id, stage, 'pending', {});
    }
    runLogBuffer.delete(String(message_id));
  }
  // All in-memory run logs cleared above. Filter for log retrieval so only entries >= clearAt are returned.
  logsClearAllTimestamp = clearAt;
  emailLogsSince.clear();
  logger.info('Results and run logs cleared for all emails', { count: ids.length, logs_cleared_from: clearAt });
  res.json({ ok: true, count: ids.length, clear_all_timestamp: clearAt });
});

// Frontend sends useLlmClassifier/useLlmDecider (from Classifier/Decider dropdowns). When true, pipeline
// forwards use_llm to ai-microservice so classify/decide use OpenRouter LLM; when false or omitted, rule-based.
app.post('/api/emails/:message_id/run', async (req, res) => {
  emailDataset.ensureLoaded();
  const message_id = req.params.message_id;
  const rec = emailDataset.get(message_id);
  if (!rec) return res.status(404).json({ error: 'Email not found' });
  const body = req.body || {};
  logger.info('Run one request body (use_llm flow)', {
    message_id,
    body_keys: Object.keys(body),
    body_useLlmClassifier: body.useLlmClassifier,
    body_useLlmDecider: body.useLlmDecider,
    body_useLlmClassifier_type: typeof body.useLlmClassifier,
    body_useLlmDecider_type: typeof body.useLlmDecider
  });
  const saved = getSettings();
  const runOptions = { useLlmClassifier: saved.useLlmClassifier, useLlmDecider: saved.useLlmDecider };
  if (body.useLlmClassifier !== undefined && body.useLlmClassifier !== null) {
    runOptions.useLlmClassifier = Boolean(body.useLlmClassifier === true || body.useLlmClassifier === 'true' || body.useLlmClassifier === 1);
  }
  if (body.useLlmDecider !== undefined && body.useLlmDecider !== null) {
    runOptions.useLlmDecider = Boolean(body.useLlmDecider === true || body.useLlmDecider === 'true' || body.useLlmDecider === 1);
  }
  logger.info('Run one requested', { message_id, useLlmClassifier: runOptions.useLlmClassifier, useLlmDecider: runOptions.useLlmDecider, saved_useLlmClassifier: saved.useLlmClassifier, saved_useLlmDecider: saved.useLlmDecider });
  // Reset stages to pending then run in background so UI can poll
  emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_PENDING);
  for (const stage of emailDataset.STAGES) {
    emailDataset.setStageResult(message_id, stage, 'pending', {});
  }
  emailDataset.setStageRunning(message_id, 'ingest');
  res.status(202).json({ accepted: true, message_id });

  setImmediate(async () => {
    const startedAt = new Date().toISOString();
    const key = String(message_id);
    runLogBuffer.delete(key);
    emailLogsSince.set(key, startedAt);
    pushRunLog(message_id, 'info', 'Triage run started', { started_at: startedAt, progress: 'started', useLlmClassifier: runOptions.useLlmClassifier, useLlmDecider: runOptions.useLlmDecider });
    logger.info('Triage run started', { message_id, started_at: startedAt, useLlmClassifier: runOptions.useLlmClassifier, useLlmDecider: runOptions.useLlmDecider });

    const email = rec.email;
    const onStageStart = (stage) => {
      const ts = new Date().toISOString();
      pushRunLog(message_id, 'info', `Stage started: ${stage}`, { stage, started_at: ts, progress: stage });
      logger.info('Triage run stage started', { message_id, stage, started_at: ts });
      emailDataset.setStageRunning(message_id, stage);
    };
    const onStageEnd = (stage, err, data) => {
      const finishedAt = new Date().toISOString();
      if (err) {
        pushRunLog(message_id, 'error', `Stage failed: ${stage} — ${err.message}`, { stage, finished_at: finishedAt, progress: `${stage} failed`, error: err.message });
        logger.error('Triage run stage failed', { message_id, stage, error: err.message, finished_at: finishedAt });
        emailDataset.setStageResult(message_id, stage, 'failed', { error: err.message });
        emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_FAILED);
        return;
      }
      const ok = stage === 'ingest' ? (data && data.success) : true;
      if (ok) {
        const meta = { stage, finished_at: finishedAt, progress: `${stage} success` };
        if (stage === 'classify' && data && (data.intent != null || data.raw_scores)) {
          meta.intent = data.intent;
          meta.confidence = data.confidence;
          meta.raw_scores = data.raw_scores;
          if (data.model_used != null) meta.model_used = data.model_used;
          if (data.llm_output != null) meta.llm_output = data.llm_output;
          const modelUsed = data.model_used == null ? '' : String(data.model_used).trim().toLowerCase();
          const isRuleBased = modelUsed === '' || modelUsed === 'rule-based';
          if (runOptions.useLlmClassifier === true && isRuleBased) {
            pushRunLog(message_id, 'error', 'LLM requested but classifier returned rule-based or empty model_used', { stage: 'classify', point: 'server_onStageEnd', useLlmClassifier: runOptions.useLlmClassifier, model_used: data.model_used });
            logger.error('LLM parameter lost or ai-microservice fallback: classifier returned rule-based/empty when useLlmClassifier=true', { message_id, point: 'server_onStageEnd_classify', useLlmClassifier: runOptions.useLlmClassifier, model_used: data.model_used });
          }
        }
        if (stage === 'decide' && data) {
          if (data.model_used != null) meta.model_used = data.model_used;
          if (data.llm_output != null) meta.llm_output = data.llm_output;
          const modelUsed = data.model_used == null ? '' : String(data.model_used).trim().toLowerCase();
          const isRuleBased = modelUsed === '' || modelUsed === 'rule-based';
          if (runOptions.useLlmDecider === true && isRuleBased) {
            pushRunLog(message_id, 'error', 'LLM requested but decider returned rule-based or empty model_used', { stage: 'decide', point: 'server_onStageEnd', useLlmDecider: runOptions.useLlmDecider, model_used: data.model_used });
            logger.error('LLM parameter lost or ai-microservice fallback: decider returned rule-based/empty when useLlmDecider=true', { message_id, point: 'server_onStageEnd_decide', useLlmDecider: runOptions.useLlmDecider, model_used: data.model_used });
          }
        }
        if (stage === 'extract' && data) {
          const ent = data.entities;
          if (ent && typeof ent === 'object') {
            meta.product_refs_count = Array.isArray(ent.product_refs) ? ent.product_refs.length : 0;
            meta.amounts_count = Array.isArray(ent.amounts) ? ent.amounts.length : 0;
            meta.dates_count = Array.isArray(ent.dates) ? ent.dates.length : 0;
            meta.contract_refs_count = Array.isArray(ent.contract_refs) ? ent.contract_refs.length : 0;
          }
          if (data.summary != null) meta.summary = data.summary;
        }
        const modelSuffix = (stage === 'classify' || stage === 'decide') && data && data.model_used
          ? ` — model: ${data.model_used}` : '';
        pushRunLog(message_id, 'info', `Stage completed: ${stage}${modelSuffix}`, meta);
        logger.info('Triage run stage completed', { message_id, stage, finished_at: finishedAt, ...(stage === 'classify' && data ? { intent: data.intent, confidence: data.confidence, raw_scores: data.raw_scores, model_used: data.model_used } : {}), ...(stage === 'decide' && data ? { model_used: data.model_used } : {}), ...(stage === 'extract' && data && data.entities ? { product_refs_count: (data.entities.product_refs || []).length, amounts_count: (data.entities.amounts || []).length, dates_count: (data.entities.dates || []).length, contract_refs_count: (data.entities.contract_refs || []).length, summary: data.summary } : {}) });
      } else {
        pushRunLog(message_id, 'error', `Stage failed: ${stage}`, { stage, finished_at: finishedAt, progress: `${stage} failed`, error: (data && data.error) || 'unknown' });
        logger.error('Triage run stage failed', { message_id, stage, error: (data && data.error) || 'unknown', finished_at: finishedAt });
      }
      emailDataset.setStageResult(message_id, stage, ok ? 'success' : 'failed', data);
      if (!ok) emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_FAILED);
    };
    const options = Object.keys(runOptions).length ? runOptions : getSettings();
    logger.info('Triage pipeline options (run one)', { message_id, options, runOptions_keys: Object.keys(runOptions), useLlmClassifier: options.useLlmClassifier, useLlmDecider: options.useLlmDecider });
    try {
      const result = await runTriagePipeline(email, aiClient, logger, { onStageStart, onStageEnd }, options);
      const finishedAt = new Date().toISOString();
      if (result.success) {
        emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_COMPLETED);
        pushRunLog(message_id, 'info', 'Triage run completed successfully', { finished_at: finishedAt, progress: 'completed', success: true });
        logger.info('Triage run completed', { message_id, success: true, finished_at: finishedAt });
      } else {
        if (result.step) {
          emailDataset.setStageResult(message_id, result.step, 'failed', { error: result.error });
        }
        emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_FAILED);
        pushRunLog(message_id, 'error', `Triage run failed: ${result.error || 'unknown'}`, { finished_at: finishedAt, progress: 'failed', success: false, step: result.step, error: result.error });
        logger.error('Triage run completed with failure', { message_id, success: false, step: result.step, error: result.error, finished_at: finishedAt });
      }
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const reason = aiClient.getErrorReason ? aiClient.getErrorReason(err) : 'other';
      pushRunLog(message_id, 'error', `Triage run error: ${err.message}`, { finished_at: finishedAt, progress: 'error', error: err.message });
      logger.error(`Triage run error: ${reason}`, { message_id, reason, error: err.message, finished_at: finishedAt });
      emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_FAILED);
    }
  });
});

// Run-all: parallel start with concurrency limit (DEMO_RUN_ALL_CONCURRENCY, default 5). All 50 attempted; timeout/connectivity retried once.
const RUN_ALL_RETRY_DELAY_MS = 2000;
const DEFAULT_RUN_ALL_CONCURRENCY = 5;

async function runOneEmail(message_id, rec, runOptions = {}) {
  const startedAt = new Date().toISOString();
  const key = String(message_id);
  runLogBuffer.delete(key);
  emailLogsSince.set(key, startedAt);
  logger.info('runOneEmail options (use_llm flow)', { message_id, runOptions_useLlmClassifier: runOptions.useLlmClassifier, runOptions_useLlmDecider: runOptions.useLlmDecider, runOptions_keys: Object.keys(runOptions) });
  pushRunLog(message_id, 'info', 'Triage run started', { started_at: startedAt, progress: 'started', useLlmClassifier: runOptions.useLlmClassifier, useLlmDecider: runOptions.useLlmDecider });
  logger.info('Triage run started', { message_id, started_at: startedAt, useLlmClassifier: runOptions.useLlmClassifier, useLlmDecider: runOptions.useLlmDecider });

  emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_PENDING);
  for (const stage of emailDataset.STAGES) {
    emailDataset.setStageResult(message_id, stage, 'pending', {});
  }
  emailDataset.setStageRunning(message_id, 'ingest');
  const email = rec.email;
  const onStageStart = (stage) => {
    const ts = new Date().toISOString();
    pushRunLog(message_id, 'info', `Stage started: ${stage}`, { stage, started_at: ts, progress: stage });
    logger.info('Triage run stage started', { message_id, stage, started_at: ts });
    emailDataset.setStageRunning(message_id, stage);
  };
  const onStageEnd = (stage, err, data) => {
    const finishedAt = new Date().toISOString();
    if (err) {
      pushRunLog(message_id, 'error', `Stage failed: ${stage} — ${err.message}`, { stage, finished_at: finishedAt, progress: `${stage} failed`, error: err.message });
      emailDataset.setStageResult(message_id, stage, 'failed', { error: err.message });
      emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_FAILED);
      return;
    }
    const ok = stage === 'ingest' ? (data && data.success) : true;
    if (ok) {
      const meta = { stage, finished_at: finishedAt, progress: `${stage} success` };
      if (stage === 'classify' && data && (data.intent != null || data.raw_scores)) {
        meta.intent = data.intent;
        meta.confidence = data.confidence;
        meta.raw_scores = data.raw_scores;
        if (data.model_used != null) meta.model_used = data.model_used;
        if (data.llm_output != null) meta.llm_output = data.llm_output;
        const _mu = data.model_used == null ? '' : String(data.model_used).trim().toLowerCase();
        if (runOptions.useLlmClassifier === true && (_mu === '' || _mu === 'rule-based')) {
          pushRunLog(message_id, 'error', 'LLM requested but classifier returned rule-based or empty model_used', { stage: 'classify', point: 'runOneEmail_onStageEnd', useLlmClassifier: runOptions.useLlmClassifier, model_used: data.model_used });
          logger.error('LLM parameter lost or ai-microservice fallback: classifier returned rule-based/empty when useLlmClassifier=true', { message_id, point: 'runOneEmail_onStageEnd_classify', useLlmClassifier: runOptions.useLlmClassifier, model_used: data.model_used });
        }
      }
      if (stage === 'decide' && data) {
        if (data.model_used != null) meta.model_used = data.model_used;
        if (data.llm_output != null) meta.llm_output = data.llm_output;
        const _mu = data.model_used == null ? '' : String(data.model_used).trim().toLowerCase();
        if (runOptions.useLlmDecider === true && (_mu === '' || _mu === 'rule-based')) {
          pushRunLog(message_id, 'error', 'LLM requested but decider returned rule-based or empty model_used', { stage: 'decide', point: 'runOneEmail_onStageEnd', useLlmDecider: runOptions.useLlmDecider, model_used: data.model_used });
          logger.error('LLM parameter lost or ai-microservice fallback: decider returned rule-based/empty when useLlmDecider=true', { message_id, point: 'runOneEmail_onStageEnd_decide', useLlmDecider: runOptions.useLlmDecider, model_used: data.model_used });
        }
      }
      if (stage === 'extract' && data) {
        const ent = data.entities;
        if (ent && typeof ent === 'object') {
          meta.product_refs_count = Array.isArray(ent.product_refs) ? ent.product_refs.length : 0;
          meta.amounts_count = Array.isArray(ent.amounts) ? ent.amounts.length : 0;
          meta.dates_count = Array.isArray(ent.dates) ? ent.dates.length : 0;
          meta.contract_refs_count = Array.isArray(ent.contract_refs) ? ent.contract_refs.length : 0;
        }
        if (data.summary != null) meta.summary = data.summary;
      }
      const modelSuffix = (stage === 'classify' || stage === 'decide') && data && data.model_used
        ? ` — model: ${data.model_used}` : '';
      pushRunLog(message_id, 'info', `Stage completed: ${stage}${modelSuffix}`, meta);
    } else {
      pushRunLog(message_id, 'error', `Stage failed: ${stage}`, { stage, finished_at: finishedAt, progress: `${stage} failed`, error: (data && data.error) || 'unknown' });
    }
    emailDataset.setStageResult(message_id, stage, ok ? 'success' : 'failed', data);
    if (!ok) emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_FAILED);
  };

  const options = Object.keys(runOptions).length ? runOptions : getSettings();
  logger.info('runOneEmail pipeline options (use_llm flow)', { message_id, options_useLlmClassifier: options.useLlmClassifier, options_useLlmDecider: options.useLlmDecider });
  let result;
  let pipelineErr = null;
  try {
    result = await runTriagePipeline(email, aiClient, logger, { onStageStart, onStageEnd }, options);
  } catch (err) {
    pipelineErr = err;
  }

  if (pipelineErr) {
    const reason = aiClient.getErrorReason ? aiClient.getErrorReason(pipelineErr) : 'other';
    const retryable = (reason === 'timeout' || reason === 'connectivity');
    if (retryable) {
      pushRunLog(message_id, 'info', 'Retrying pipeline once after timeout/connectivity', { reason, delay_ms: RUN_ALL_RETRY_DELAY_MS });
      logger.info('Run-all retrying once after timeout/connectivity', { message_id, reason });
      await new Promise((r) => setTimeout(r, RUN_ALL_RETRY_DELAY_MS));
      for (const stage of emailDataset.STAGES) {
        emailDataset.setStageResult(message_id, stage, 'pending', {});
      }
      emailDataset.setStageRunning(message_id, 'ingest');
      pipelineErr = null;
      try {
        result = await runTriagePipeline(email, aiClient, logger, { onStageStart, onStageEnd }, options);
      } catch (err2) {
        pipelineErr = err2;
      }
    }
  }

  if (pipelineErr) {
    const finishedAt = new Date().toISOString();
    const reason = aiClient.getErrorReason ? aiClient.getErrorReason(pipelineErr) : 'other';
    pushRunLog(message_id, 'error', `Triage run error: ${pipelineErr.message}`, { finished_at: finishedAt, progress: 'error', error: pipelineErr.message });
    logger.error(`Run-all item error: ${reason}`, { message_id, reason, error: pipelineErr.message });
    emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_FAILED);
    return;
  }

  const finishedAt = new Date().toISOString();
  if (result.success) {
    emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_COMPLETED);
    pushRunLog(message_id, 'info', 'Triage run completed successfully', { finished_at: finishedAt, progress: 'completed', success: true });
  } else {
    if (result.step) {
      emailDataset.setStageResult(message_id, result.step, 'failed', { error: result.error });
    }
    emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_FAILED);
    pushRunLog(message_id, 'error', `Triage run failed: ${result.error || 'unknown'}`, { finished_at: finishedAt, progress: 'failed', success: false, step: result.step, error: result.error });
  }
}

app.post('/api/run-all', async (req, res) => {
  emailDataset.ensureLoaded();
  const ids = emailDataset.getMessageIds();
  const body = req.body || {};
  logger.info('Run-all request body (use_llm flow)', {
    body_keys: Object.keys(body),
    body_useLlmClassifier: body.useLlmClassifier,
    body_useLlmDecider: body.useLlmDecider,
    body_useLlmClassifier_type: typeof body.useLlmClassifier,
    body_useLlmDecider_type: typeof body.useLlmDecider,
    count: ids.length
  });
  const raw = body && (typeof body.concurrency === 'number' || typeof body.concurrency === 'string') ? body.concurrency : null;
  const requested = raw != null ? parseInt(raw, 10) : null;
  const defaultConcurrency = Math.max(1, parseInt(process.env.DEMO_RUN_ALL_CONCURRENCY || String(DEFAULT_RUN_ALL_CONCURRENCY), 10));
  const concurrency = Math.min(ids.length, Math.max(1, (!isNaN(requested) && requested >= 1 ? requested : defaultConcurrency)));
  const saved = getSettings();
  const runAllOptions = { useLlmClassifier: saved.useLlmClassifier, useLlmDecider: saved.useLlmDecider };
  if (body.useLlmClassifier !== undefined && body.useLlmClassifier !== null) {
    runAllOptions.useLlmClassifier = Boolean(body.useLlmClassifier === true || body.useLlmClassifier === 'true' || body.useLlmClassifier === 1);
  }
  if (body.useLlmDecider !== undefined && body.useLlmDecider !== null) {
    runAllOptions.useLlmDecider = Boolean(body.useLlmDecider === true || body.useLlmDecider === 'true' || body.useLlmDecider === 1);
  }
  logger.info('Run-all requested', { useLlmClassifier: runAllOptions.useLlmClassifier, useLlmDecider: runAllOptions.useLlmDecider, saved_useLlmClassifier: saved.useLlmClassifier, saved_useLlmDecider: saved.useLlmDecider, count: ids.length, concurrency });
  // runAllOptions (or getSettings() when empty) passed to each run → use_llm to ai-microservice → OpenRouter when true
  res.status(202).json({ accepted: true, count: ids.length, concurrency });

  setImmediate(async () => {
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < ids.length) {
        const message_id = ids[nextIndex++];
        const rec = emailDataset.get(message_id);
        if (!rec) continue;
        try {
          await runOneEmail(message_id, rec, runAllOptions);
        } catch (outerErr) {
          logger.error('Run-all iteration error (continuing queue)', { message_id, error: outerErr.message });
          try {
            pushRunLog(message_id, 'error', `Triage run error: ${outerErr.message}`, { progress: 'error', error: outerErr.message });
            emailDataset.setOverallStatus(message_id, emailDataset.OVERALL_FAILED);
          } catch (_) { /* ignore */ }
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    logger.info('Run-all completed', { count: ids.length, concurrency });
  });
});

// Avoid 404 for /favicon.ico (browsers request it by default)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Frontend at root: https://aeps.alfares.cz only (served at /)
const appDir = path.join(__dirname, 'public', 'app');
const sendAppIndex = (req, res) => res.sendFile(path.join(appDir, 'index.html'));
app.get('/', sendAppIndex);
app.use(express.static(appDir));

// Check reachability of LOGGING_SERVICE_URL (for "See logs…") and AI_SERVICE_URL (email-triage agents)
// Keep short so /health returns within deploy script's health-check timeout (5s)
const HEALTH_CHECK_TIMEOUT_MS = 2000;

async function checkLoggingReachable() {
  const url = process.env.LOGGING_SERVICE_URL;
  if (!url || !url.trim()) return 'not_configured';
  const base = url.replace(/\/$/, '');
  const service = process.env.SERVICE_NAME || 'agentic-email-processing-system';
  const queryUrl = `${base}/api/logs/query?service=${encodeURIComponent(service)}&limit=1`;
  try {
    const res = await fetch(queryUrl, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
    return res.ok ? 'ok' : 'unreachable';
  } catch (err) {
    const reason = aiClient.getErrorReason ? aiClient.getErrorReason(err) : 'other';
    // Log to console only during health so we don't block on remote logger
    if (process.env.NODE_ENV === 'production') {
      console.error(`[${process.env.SERVICE_NAME || 'agentic-email-processing-system'}] Health check: logging unreachable (${reason})`);
    } else {
      logger.error(`Health check: logging service unreachable (${reason})`, {
        reason,
        error: err.message,
        duration_ms: HEALTH_CHECK_TIMEOUT_MS,
        url: base
      });
    }
    return 'unreachable';
  }
}

async function checkAiReachable() {
  return aiClient.checkAiHealth ? aiClient.checkAiHealth() : 'not_configured';
}

// Minimal liveness for Docker healthcheck (no external calls); use this in docker-compose healthcheck so container becomes healthy quickly
app.get('/live', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/health', async (req, res) => {
  const [logging, ai] = await Promise.all([checkLoggingReachable(), checkAiReachable()]);
  res.json({
    status: 'ok',
    service: process.env.SERVICE_NAME || 'agentic-email-processing-system',
    logging,
    ai
  });
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Phase 1+3 listening on port ${PORT} (email-triage agents via AI_SERVICE_URL)`);
  // Warm up connection to AI service so first triage request does not hit cold connect (avoids 5s timeout)
  setImmediate(() => {
    try {
      if (typeof aiClient.checkAiHealth === 'function') {
        aiClient.checkAiHealth().then((status) => {
          logger.info('AI connection warmup', { status });
        }).catch((err) => {
          logger.info('AI connection warmup skipped or failed', { error: err && err.message });
        });
      }
    } catch (err) {
      logger.info('AI connection warmup error', { error: err && err.message });
    }
  });
});
