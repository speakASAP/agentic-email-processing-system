/**
 * Agentic Email Processing System — Phase 1+3: Ingest, Classify, Extract, Decide, Act/Escalate.
 * Uses email-triage agents from ai-microservice (AI_SERVICE_URL).
 * Contracts: docs/contracts/ (email-schema, event-schema, intent-taxonomy, extractor, action-set, routing-rules).
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const aiClient = require('./lib/ai_client');
const logger = require('./utils/logger');
const { runTriagePipeline } = require('./lib/triage_pipeline');
const demoDataset = require('./lib/demo_dataset');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3374;

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
    const email = rec.email;
    const onStageStart = (stage) => {
      demoDataset.setStageRunning(message_id, stage);
    };
    const onStageEnd = (stage, err, data) => {
      if (err) {
        demoDataset.setStageResult(message_id, stage, 'failed', { error: err.message });
        demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
        return;
      }
      const ok = stage === 'ingest' ? (data && data.success) : true;
      demoDataset.setStageResult(message_id, stage, ok ? 'success' : 'failed', data);
      if (!ok) demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
    };
    try {
      const result = await runTriagePipeline(email, aiClient, logger, { onStageStart, onStageEnd });
      if (result.success) {
        demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_COMPLETED);
      } else {
        if (result.step) {
          demoDataset.setStageResult(message_id, result.step, 'failed', { error: result.error });
        }
        demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
      }
      logger.info('Demo run completed', { message_id, success: result.success });
    } catch (err) {
      logger.error('Demo run error', { message_id, error: err.message });
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
      demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_PENDING);
      for (const stage of demoDataset.STAGES) {
        demoDataset.setStageResult(message_id, stage, 'pending', {});
      }
      demoDataset.setStageRunning(message_id, 'ingest');
      const email = rec.email;
      const onStageStart = (stage) => { demoDataset.setStageRunning(message_id, stage); };
      const onStageEnd = (stage, err, data) => {
        if (err) {
          demoDataset.setStageResult(message_id, stage, 'failed', { error: err.message });
          demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
          return;
        }
        const ok = stage === 'ingest' ? (data && data.success) : true;
        demoDataset.setStageResult(message_id, stage, ok ? 'success' : 'failed', data);
        if (!ok) demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
      };
      try {
        const result = await runTriagePipeline(email, aiClient, logger, { onStageStart, onStageEnd });
        if (result.success) {
          demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_COMPLETED);
        } else {
          if (result.step) {
            demoDataset.setStageResult(message_id, result.step, 'failed', { error: result.error });
          }
          demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
        }
      } catch (err) {
        logger.error('Demo run-all item error', { message_id, error: err.message });
        demoDataset.setOverallStatus(message_id, demoDataset.OVERALL_FAILED);
      }
    }
    logger.info('Demo run-all completed', { count: ids.length });
  });
});

// Static demo UI: serve index.html for /demo and /demo/, then static assets
const demoDir = path.join(__dirname, 'public', 'demo');
const sendDemoIndex = (req, res) => res.sendFile(path.join(demoDir, 'index.html'));
app.get('/demo', sendDemoIndex);
app.get('/demo/', sendDemoIndex);
app.use('/demo', express.static(demoDir));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: process.env.SERVICE_NAME || 'agentic-email-processing-system' });
});

app.listen(PORT, () => {
  logger.info(`Phase 1+3 listening on port ${PORT} (email-triage agents via AI_SERVICE_URL)`);
});
