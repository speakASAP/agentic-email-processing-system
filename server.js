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
    console.warn('[agentic-email-processing-system] Failed to write demo log to file:', err.message);
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
    logger.error('Ingest error (ai-microservice)', { error: err.message });
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
      error: err.status === 400 ? (err.body && err.body.error) || err.message : 'AI service unavailable'
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
    logger.error('Classifier error (ai-microservice)', { error: err.message });
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
app.get('/api/demo/emails/:message_id/logs', async (req, res) => {
  demoDataset.ensureLoaded();
  const message_id = req.params.message_id;
  const rec = demoDataset.get(message_id);
  if (!rec) return res.status(404).json({ error: 'Email not found' });

  const LOGGING_SERVICE_URL = process.env.LOGGING_SERVICE_URL || '';
  const SERVICE_NAME = process.env.SERVICE_NAME || 'agentic-email-processing-system';
  const limit = Math.min(Number(req.query.limit) || 300, 500);

  const inMemory = demoLogBuffer.get(String(message_id)) || [];
  if (!LOGGING_SERVICE_URL) {
    const sorted = [...inMemory].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    return res.json({ logs: sorted, message: 'Logging service not configured; showing in-memory progress only' });
  }

  const base = LOGGING_SERVICE_URL.replace(/\/$/, '');
  const queryUrl = `${base}/api/logs/query?service=${encodeURIComponent(SERVICE_NAME)}&limit=${limit}`;
  try {
    const response = await fetch(queryUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      logger.warn('Logs query failed', { status: response.status, message_id });
      const merged = [...inMemory].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
      return res.json({ logs: merged, error: `Logging service returned ${response.status}` });
    }
    const data = await response.json();
    const all = (data && data.data && Array.isArray(data.data)) ? data.data : [];
    const fromService = all.filter((entry) => {
      const meta = entry.metadata || {};
      return String(meta.message_id || '') === String(message_id);
    });
    const merged = [...inMemory, ...fromService].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    return res.json({ logs: merged });
  } catch (err) {
    logger.error('Demo logs fetch error', { message_id, error: err.message });
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
        pushDemoLog(message_id, 'info', `Stage completed: ${stage}`, { stage, finished_at: finishedAt, progress: `${stage} success` });
        logger.info('Demo run stage completed', { message_id, stage, finished_at: finishedAt });
      } else {
        pushDemoLog(message_id, 'error', `Stage failed: ${stage}`, { stage, finished_at: finishedAt, progress: `${stage} failed`, error: (data && data.error) || 'unknown' });
        logger.error('Demo run stage failed', { message_id, stage, error: (data && data.error) || 'unknown', finished_at: finishedAt });
      }
      demoDataset.setStageResult(message_id, stage, ok ? 'success' : 'failed', data);
      if (!ok) demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
    };
    try {
      const result = await runTriagePipeline(email, aiClient, logger, { onStageStart, onStageEnd });
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
      pushDemoLog(message_id, 'error', `Demo run error: ${err.message}`, { finished_at: finishedAt, progress: 'error', error: err.message });
      logger.error('Demo run error', { message_id, error: err.message, finished_at: finishedAt });
      demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
    }
  });
});

// Run-all processes each email individually (max 30 items per AI request is respected per pipeline).
app.post('/api/demo/run-all', async (req, res) => {
  demoDataset.ensureLoaded();
  const ids = demoDataset.getMessageIds();
  res.status(202).json({ accepted: true, count: ids.length });

  setImmediate(async () => {
    for (const message_id of ids) {
      const rec = demoDataset.get(message_id);
      if (!rec) continue;
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
          pushDemoLog(message_id, 'info', `Stage completed: ${stage}`, { stage, finished_at: finishedAt, progress: `${stage} success` });
        } else {
          pushDemoLog(message_id, 'error', `Stage failed: ${stage}`, { stage, finished_at: finishedAt, progress: `${stage} failed`, error: (data && data.error) || 'unknown' });
        }
        demoDataset.setStageResult(message_id, stage, ok ? 'success' : 'failed', data);
        if (!ok) demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
      };
      try {
        const result = await runTriagePipeline(email, aiClient, logger, { onStageStart, onStageEnd });
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
      } catch (err) {
        const finishedAt = new Date().toISOString();
        pushDemoLog(message_id, 'error', `Demo run error: ${err.message}`, { finished_at: finishedAt, progress: 'error', error: err.message });
        logger.error('Demo run-all item error', { message_id, error: err.message });
        demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
      }
    }
    logger.info('Demo run-all completed', { count: ids.length });
  });
});

// Frontend at root: https://aeps.alfares.cz only (served at /)
const demoDir = path.join(__dirname, 'public', 'demo');
const sendDemoIndex = (req, res) => res.sendFile(path.join(demoDir, 'index.html'));
app.get('/', sendDemoIndex);
app.use(express.static(demoDir));

// Check reachability of LOGGING_SERVICE_URL (for "See logs…") and AI_SERVICE_URL (email-triage agents)
const HEALTH_CHECK_TIMEOUT_MS = 3000;

async function checkLoggingReachable() {
  const url = process.env.LOGGING_SERVICE_URL;
  if (!url || !url.trim()) return 'not_configured';
  const base = url.replace(/\/$/, '');
  const service = process.env.SERVICE_NAME || 'agentic-email-processing-system';
  const queryUrl = `${base}/api/logs/query?service=${encodeURIComponent(service)}&limit=1`;
  try {
    const res = await fetch(queryUrl, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
    return res.ok ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

async function checkAiReachable() {
  const url = process.env.AI_SERVICE_URL;
  if (!url || !url.trim()) return 'not_configured';
  const base = url.replace(/\/$/, '');
  const healthUrl = `${base}/health`;
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
    return res.ok ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

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
});
