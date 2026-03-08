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
const demoDataset = require('./lib/demo_dataset');

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

// In-memory demo log buffer per message_id (so "See logs..." shows progress even if LOGGING_SERVICE_URL is down)
const DEMO_LOG_BUFFER_MAX = 100;
const demoLogBuffer = new Map();

// Applications directory: logs stored in 3 places — central service, in-memory, and local logs/ dir
const LOG_DIR = process.env.LOG_DIR || 'logs';
const DEMO_LOG_FILE = 'demo.log';

function getDemoLogPath() {
  const dir = path.isAbsolute(LOG_DIR) ? LOG_DIR : path.join(__dirname, LOG_DIR);
  return path.join(dir, DEMO_LOG_FILE);
}

function appendDemoLogToFile(entry) {
  try {
    const filePath = getDemoLogPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    logger.error('Failed to write demo log to file', { error: err.message });
  }
}

function pushDemoLog(message_id, level, message, metadata = {}) {
  const key = String(message_id);
  const entry = {
    level,
    message,
    service: process.env.SERVICE_NAME || 'agentic-email-processing-system',
    timestamp: new Date().toISOString(),
    metadata: { message_id: key, ...metadata }
  };
  if (!demoLogBuffer.has(key)) demoLogBuffer.set(key, []);
  const arr = demoLogBuffer.get(key);
  arr.push(entry);
  if (arr.length > DEMO_LOG_BUFFER_MAX) arr.shift();
  appendDemoLogToFile(entry);
}

// Demo dataset: load once at startup
demoDataset.ensureLoaded();
logger.info(`Demo dataset loaded: ${demoDataset.getMessageIds().length} emails`);

// --- Ingest (proxies to ai-microservice) ---
app.post('/api/ingest', async (req, res) => {
  const ts = new Date().toISOString();
  const message_id = (req.body && req.body.message_id != null) ? String(req.body.message_id) : 'unknown';
  const tenant_id = (req.body && req.body.tenant_id != null) ? String(req.body.tenant_id) : '';

  try {
    const result = await aiClient.ingest(req.body || {});

    if (!result.success) {
      await logger.emitEvent({
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

    await logger.emitEvent({
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
    await logger.emitEvent({
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

    await logger.emitEvent({
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
    await logger.emitEvent({
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

    await logger.emitEvent({
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
    await logger.emitEvent({
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

    await logger.emitEvent({
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
    await logger.emitEvent({
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

// --- Demo API: 50-email dataset and per-email workflow state ---
// In-memory analysis mode: user can switch AI (LLM) vs rule-based for Classifier and Decider (compare output)
let demoAnalysisMode = { useLlmClassifier: false, useLlmDecider: false };

function getDemoSettings() {
  return { useLlmClassifier: demoAnalysisMode.useLlmClassifier, useLlmDecider: demoAnalysisMode.useLlmDecider };
}

app.get('/api/demo/settings', (req, res) => {
  res.json(getDemoSettings());
});

app.put('/api/demo/settings', (req, res) => {
  const body = req.body || {};
  if (typeof body.useLlmClassifier === 'boolean') demoAnalysisMode.useLlmClassifier = body.useLlmClassifier;
  if (typeof body.useLlmDecider === 'boolean') demoAnalysisMode.useLlmDecider = body.useLlmDecider;
  logger.info('Demo settings updated', getDemoSettings());
  res.json(getDemoSettings());
});

app.get('/api/demo/emails', (req, res) => {
  demoDataset.ensureLoaded();
  const list = demoDataset.getList();
  res.json({ emails: list });
});

app.get('/api/demo/emails/:message_id', (req, res) => {
  demoDataset.ensureLoaded();
  const rec = demoDataset.get(req.params.message_id);
  if (!rec) return res.status(404).json({ error: 'Email not found' });
  res.json(rec);
});

// Demo: fetch logs for this email (message_id) from central logging service for "See logs..." in GUI
// Query: ?source=memory = return only in-memory logs immediately (no central fetch). Omit for merged logs.
const LOGS_CENTRAL_TIMEOUT_MS = Math.min(10000, Math.max(2000, parseInt(process.env.LOGS_CENTRAL_TIMEOUT_MS || '4000', 10) || 4000));

app.get('/api/demo/emails/:message_id/logs', async (req, res) => {
  demoDataset.ensureLoaded();
  const message_id = req.params.message_id;
  const rec = demoDataset.get(message_id);
  if (!rec) return res.status(404).json({ error: 'Email not found' });

  const LOGGING_SERVICE_URL = process.env.LOGGING_SERVICE_URL || '';
  const SERVICE_NAME = process.env.SERVICE_NAME || 'agentic-email-processing-system';
  const limit = Math.min(Number(req.query.limit) || 300, 500);
  const sourceMemoryOnly = (req.query.source || '').toLowerCase() === 'memory';

  const inMemory = demoLogBuffer.get(String(message_id)) || [];
  const sortedMemory = [...inMemory].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

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
      const merged = [...inMemory].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
      return res.json({ logs: merged, error: `Logging service returned ${response.status}` });
    }
    const data = await response.json();
    const all = (data && data.data && Array.isArray(data.data)) ? data.data : [];
    const fromService = all
      .filter((entry) => {
        const meta = entry.metadata || {};
        return String(meta.message_id || '') === String(message_id);
      })
      .map((entry) => ({
        timestamp: entry.timestamp || entry.ts,
        level: entry.level || entry.severity || 'info',
        message: entry.message || entry.msg || '',
        metadata: entry.metadata || {}
      }));
    const merged = [...inMemory, ...fromService].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    return res.json({ logs: merged });
  } catch (err) {
    const reason = aiClient.getErrorReason ? aiClient.getErrorReason(err) : 'other';
    logger.error(`Demo logs fetch error: ${reason}`, { message_id, reason, error: err.message });
    const merged = [...inMemory].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    return res.json({ logs: merged, error: err.message || 'Failed to fetch logs' });
  }
});

app.put('/api/demo/emails/:message_id', (req, res) => {
  demoDataset.ensureLoaded();
  const message_id = req.params.message_id;
  const rec = demoDataset.get(message_id);
  if (!rec) return res.status(404).json({ error: 'Email not found' });
  const payload = req.body && req.body.email ? req.body.email : req.body;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Body must include email payload (e.g. { email: { subject, sender, body_plain } })' });
  }
  const ok = demoDataset.updateEmail(message_id, payload);
  if (!ok) return res.status(400).json({ error: 'Update failed' });
  logger.info('Demo email updated', { message_id });
  res.json({ ok: true, message_id });
});

app.post('/api/demo/emails/:message_id/clear', (req, res) => {
  demoDataset.ensureLoaded();
  const message_id = req.params.message_id;
  const rec = demoDataset.get(message_id);
  if (!rec) return res.status(404).json({ error: 'Email not found' });
  demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_PENDING);
  for (const stage of demoDataset.STAGES) {
    demoDataset.setStageResult(message_id, stage, 'pending', {});
  }
  logger.info('Demo results cleared', { message_id });
  res.json({ ok: true, message_id });
});

app.post('/api/demo/clear-all', (req, res) => {
  demoDataset.ensureLoaded();
  const ids = demoDataset.getMessageIds();
  for (const message_id of ids) {
    demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_PENDING);
    for (const stage of demoDataset.STAGES) {
      demoDataset.setStageResult(message_id, stage, 'pending', {});
    }
  }
  logger.info('Demo results cleared for all emails', { count: ids.length });
  res.json({ ok: true, count: ids.length });
});

app.post('/api/demo/emails/:message_id/run', async (req, res) => {
  demoDataset.ensureLoaded();
  const message_id = req.params.message_id;
  const rec = demoDataset.get(message_id);
  if (!rec) return res.status(404).json({ error: 'Email not found' });
  // Reset stages to pending then run in background so UI can poll
  demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_PENDING);
  for (const stage of demoDataset.STAGES) {
    demoDataset.setStageResult(message_id, stage, 'pending', {});
  }
  demoDataset.setStageRunning(message_id, 'ingest');
  res.status(202).json({ accepted: true, message_id });

  setImmediate(async () => {
    const startedAt = new Date().toISOString();
    pushDemoLog(message_id, 'info', 'Demo run started', { started_at: startedAt, progress: 'started' });
    logger.info('Demo run started', { message_id, started_at: startedAt });

    const email = rec.email;
    const onStageStart = (stage) => {
      const ts = new Date().toISOString();
      pushDemoLog(message_id, 'info', `Stage started: ${stage}`, { stage, started_at: ts, progress: stage });
      logger.info('Demo run stage started', { message_id, stage, started_at: ts });
      demoDataset.setStageRunning(message_id, stage);
    };
    const onStageEnd = (stage, err, data) => {
      const finishedAt = new Date().toISOString();
      if (err) {
        pushDemoLog(message_id, 'error', `Stage failed: ${stage} — ${err.message}`, { stage, finished_at: finishedAt, progress: `${stage} failed`, error: err.message });
        logger.error('Demo run stage failed', { message_id, stage, error: err.message, finished_at: finishedAt });
        demoDataset.setStageResult(message_id, stage, 'failed', { error: err.message });
        demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
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
        }
        if (stage === 'decide' && data) {
          if (data.model_used != null) meta.model_used = data.model_used;
          if (data.llm_output != null) meta.llm_output = data.llm_output;
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
        pushDemoLog(message_id, 'info', `Stage completed: ${stage}`, meta);
        logger.info('Demo run stage completed', { message_id, stage, finished_at: finishedAt, ...(stage === 'classify' && data ? { intent: data.intent, confidence: data.confidence, raw_scores: data.raw_scores } : {}), ...(stage === 'extract' && data && data.entities ? { product_refs_count: (data.entities.product_refs || []).length, amounts_count: (data.entities.amounts || []).length, dates_count: (data.entities.dates || []).length, contract_refs_count: (data.entities.contract_refs || []).length, summary: data.summary } : {}) });
      } else {
        pushDemoLog(message_id, 'error', `Stage failed: ${stage}`, { stage, finished_at: finishedAt, progress: `${stage} failed`, error: (data && data.error) || 'unknown' });
        logger.error('Demo run stage failed', { message_id, stage, error: (data && data.error) || 'unknown', finished_at: finishedAt });
      }
      demoDataset.setStageResult(message_id, stage, ok ? 'success' : 'failed', data);
      if (!ok) demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
    };
    try {
      const result = await runTriagePipeline(email, aiClient, logger, { onStageStart, onStageEnd }, getDemoSettings());
      const finishedAt = new Date().toISOString();
      if (result.success) {
        demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_COMPLETED);
        pushDemoLog(message_id, 'info', 'Demo run completed successfully', { finished_at: finishedAt, progress: 'completed', success: true });
        logger.info('Demo run completed', { message_id, success: true, finished_at: finishedAt });
      } else {
        if (result.step) {
          demoDataset.setStageResult(message_id, result.step, 'failed', { error: result.error });
        }
        demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
        pushDemoLog(message_id, 'error', `Demo run failed: ${result.error || 'unknown'}`, { finished_at: finishedAt, progress: 'failed', success: false, step: result.step, error: result.error });
        logger.error('Demo run completed with failure', { message_id, success: false, step: result.step, error: result.error, finished_at: finishedAt });
      }
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const reason = aiClient.getErrorReason ? aiClient.getErrorReason(err) : 'other';
      pushDemoLog(message_id, 'error', `Demo run error: ${err.message}`, { finished_at: finishedAt, progress: 'error', error: err.message });
      logger.error(`Demo run error: ${reason}`, { message_id, reason, error: err.message, finished_at: finishedAt });
      demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
    }
  });
});

// Run-all: parallel start with concurrency limit (DEMO_RUN_ALL_CONCURRENCY, default 5). All 50 attempted; timeout/connectivity retried once.
const RUN_ALL_RETRY_DELAY_MS = 2000;
const DEFAULT_RUN_ALL_CONCURRENCY = 5;

async function runOneEmail(message_id, rec) {
  const startedAt = new Date().toISOString();
  pushDemoLog(message_id, 'info', 'Demo run started', { started_at: startedAt, progress: 'started' });
  logger.info('Demo run started', { message_id, started_at: startedAt });

  demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_PENDING);
  for (const stage of demoDataset.STAGES) {
    demoDataset.setStageResult(message_id, stage, 'pending', {});
  }
  demoDataset.setStageRunning(message_id, 'ingest');
  const email = rec.email;
  const onStageStart = (stage) => {
    const ts = new Date().toISOString();
    pushDemoLog(message_id, 'info', `Stage started: ${stage}`, { stage, started_at: ts, progress: stage });
    logger.info('Demo run stage started', { message_id, stage, started_at: ts });
    demoDataset.setStageRunning(message_id, stage);
  };
  const onStageEnd = (stage, err, data) => {
    const finishedAt = new Date().toISOString();
    if (err) {
      pushDemoLog(message_id, 'error', `Stage failed: ${stage} — ${err.message}`, { stage, finished_at: finishedAt, progress: `${stage} failed`, error: err.message });
      demoDataset.setStageResult(message_id, stage, 'failed', { error: err.message });
      demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
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
      }
      if (stage === 'decide' && data) {
        if (data.model_used != null) meta.model_used = data.model_used;
        if (data.llm_output != null) meta.llm_output = data.llm_output;
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
      pushDemoLog(message_id, 'info', `Stage completed: ${stage}`, meta);
    } else {
      pushDemoLog(message_id, 'error', `Stage failed: ${stage}`, { stage, finished_at: finishedAt, progress: `${stage} failed`, error: (data && data.error) || 'unknown' });
    }
    demoDataset.setStageResult(message_id, stage, ok ? 'success' : 'failed', data);
    if (!ok) demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
  };

  let result;
  let pipelineErr = null;
  try {
    result = await runTriagePipeline(email, aiClient, logger, { onStageStart, onStageEnd }, getDemoSettings());
  } catch (err) {
    pipelineErr = err;
  }

  if (pipelineErr) {
    const reason = aiClient.getErrorReason ? aiClient.getErrorReason(pipelineErr) : 'other';
    const retryable = (reason === 'timeout' || reason === 'connectivity');
    if (retryable) {
      pushDemoLog(message_id, 'info', 'Retrying pipeline once after timeout/connectivity', { reason, delay_ms: RUN_ALL_RETRY_DELAY_MS });
      logger.info('Demo run-all retrying once after timeout/connectivity', { message_id, reason });
      await new Promise((r) => setTimeout(r, RUN_ALL_RETRY_DELAY_MS));
      for (const stage of demoDataset.STAGES) {
        demoDataset.setStageResult(message_id, stage, 'pending', {});
      }
      demoDataset.setStageRunning(message_id, 'ingest');
      pipelineErr = null;
      try {
        result = await runTriagePipeline(email, aiClient, logger, { onStageStart, onStageEnd }, getDemoSettings());
      } catch (err2) {
        pipelineErr = err2;
      }
    }
  }

  if (pipelineErr) {
    const finishedAt = new Date().toISOString();
    const reason = aiClient.getErrorReason ? aiClient.getErrorReason(pipelineErr) : 'other';
    pushDemoLog(message_id, 'error', `Demo run error: ${pipelineErr.message}`, { finished_at: finishedAt, progress: 'error', error: pipelineErr.message });
    logger.error(`Demo run-all item error: ${reason}`, { message_id, reason, error: pipelineErr.message });
    demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
    return;
  }

  const finishedAt = new Date().toISOString();
  if (result.success) {
    demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_COMPLETED);
    pushDemoLog(message_id, 'info', 'Demo run completed successfully', { finished_at: finishedAt, progress: 'completed', success: true });
  } else {
    if (result.step) {
      demoDataset.setStageResult(message_id, result.step, 'failed', { error: result.error });
    }
    demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
    pushDemoLog(message_id, 'error', `Demo run failed: ${result.error || 'unknown'}`, { finished_at: finishedAt, progress: 'failed', success: false, step: result.step, error: result.error });
  }
}

app.post('/api/demo/run-all', async (req, res) => {
  demoDataset.ensureLoaded();
  const ids = demoDataset.getMessageIds();
  const raw = req.body && (typeof req.body.concurrency === 'number' || typeof req.body.concurrency === 'string') ? req.body.concurrency : null;
  const requested = raw != null ? parseInt(raw, 10) : null;
  const defaultConcurrency = Math.max(1, parseInt(process.env.DEMO_RUN_ALL_CONCURRENCY || String(DEFAULT_RUN_ALL_CONCURRENCY), 10));
  const concurrency = Math.min(ids.length, Math.max(1, (!isNaN(requested) && requested >= 1 ? requested : defaultConcurrency)));
  res.status(202).json({ accepted: true, count: ids.length, concurrency });

  setImmediate(async () => {
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < ids.length) {
        const message_id = ids[nextIndex++];
        const rec = demoDataset.get(message_id);
        if (!rec) continue;
        try {
          await runOneEmail(message_id, rec);
        } catch (outerErr) {
          logger.error('Demo run-all iteration error (continuing queue)', { message_id, error: outerErr.message });
          try {
            pushDemoLog(message_id, 'error', `Demo run error: ${outerErr.message}`, { progress: 'error', error: outerErr.message });
            demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
          } catch (_) { /* ignore */ }
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    logger.info('Demo run-all completed', { count: ids.length, concurrency });
  });
});

// Avoid 404 for /favicon.ico (browsers request it by default)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Frontend at root: https://aeps.alfares.cz only (served at /)
const demoDir = path.join(__dirname, 'public', 'demo');
const sendDemoIndex = (req, res) => res.sendFile(path.join(demoDir, 'index.html'));
app.get('/', sendDemoIndex);
app.use(express.static(demoDir));

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
  // Warm up connection to AI service so first demo/triage request does not hit cold connect (avoids 5s timeout)
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
