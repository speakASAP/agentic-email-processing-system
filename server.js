/**
 * Agentic Email Processing System — Phase 1+3: Ingest, Classify, Extract, Decide, Act/Escalate.
 * Uses email-triage agents from ai-microservice (AI_SERVICE_URL).
 * Contracts: docs/contracts/ (email-schema, event-schema, intent-taxonomy, extractor, action-set, routing-rules).
 */

require('dotenv').config();
const express = require('express');
const aiClient = require('./lib/ai_client');
const logger = require('./utils/logger');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3374;

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
  const ts = new Date().toISOString();
  const raw = req.body || {};
  let message_id = raw.message_id != null ? String(raw.message_id) : 'unknown';
  let tenant_id = raw.tenant_id != null ? String(raw.tenant_id) : '';

  try {
    // 1. Ingest
    const ingestResult = await aiClient.ingest(raw);
    if (!ingestResult.success) {
      await logger.emitEvent({
        message_id,
        timestamp: ts,
        agent: 'ingest',
        decision: 'rejected',
        confidence: null,
        escalation_reason: ingestResult.escalation_reason || 'incomplete_data',
        tenant_id,
        details: { error: ingestResult.error }
      });
      return res.status(400).json({
        success: false,
        step: 'ingest',
        error: ingestResult.error,
        escalation_reason: ingestResult.escalation_reason || 'incomplete_data'
      });
    }
    const payload = ingestResult.payload;
    message_id = payload.message_id;
    tenant_id = payload.tenant_id || tenant_id;
    await logger.emitEvent({
      message_id,
      timestamp: ts,
      agent: 'ingest',
      decision: 'accepted',
      confidence: null,
      escalation_reason: null,
      tenant_id
    });

    // 2. Classify
    let intent, confidence, raw_scores;
    try {
      const classifyResult = await aiClient.classify({ payload });
      intent = classifyResult.intent;
      confidence = classifyResult.confidence;
      raw_scores = classifyResult.raw_scores;
      await logger.emitEvent({
        message_id,
        timestamp: ts,
        agent: 'classifier',
        decision: intent,
        confidence,
        escalation_reason: null,
        tenant_id,
        intent,
        details: raw_scores ? { raw_scores } : undefined
      });
    } catch (err) {
      logger.error('Triage classify error', { error: err.message });
      const escReason = err.status === 400 && err.body && err.body.escalation_reason ? err.body.escalation_reason : null;
      await logger.emitEvent({
        message_id,
        timestamp: ts,
        agent: 'classifier',
        decision: 'error',
        confidence: null,
        escalation_reason: escReason,
        tenant_id,
        details: { error: err.message }
      });
      const status = err.status === 400 ? 400 : 503;
      return res.status(status).json({ success: false, step: 'classify', error: err.message });
    }

    // 3. Extract
    let entities = [];
    let extractSummary;
    try {
      const extractResult = await aiClient.extract({ payload, intent });
      entities = extractResult.entities || [];
      extractSummary = extractResult.summary;
      await logger.emitEvent({
        message_id,
        timestamp: ts,
        agent: 'extractor',
        decision: 'extracted',
        confidence: null,
        escalation_reason: null,
        tenant_id,
        details: extractSummary ? { summary: extractSummary } : undefined
      });
    } catch (err) {
      logger.error('Triage extract error', { error: err.message });
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
      return res.status(status).json({ success: false, step: 'extract', error: err.message });
    }

    // 4. Decide
    let action, escalation_reason, queue;
    try {
      const decideResult = await aiClient.decide({
        intent,
        confidence,
        message_id,
        tenant_id,
        entities
      });
      action = decideResult.action;
      escalation_reason = decideResult.escalation_reason || null;
      queue = decideResult.queue || null;
      await logger.emitEvent({
        message_id,
        timestamp: ts,
        agent: 'action_decider',
        decision: action,
        confidence: null,
        escalation_reason,
        tenant_id,
        action,
        details: queue ? { queue } : undefined
      });
    } catch (err) {
      logger.error('Triage decide error', { error: err.message });
      const escReason = err.status === 400 && err.body && err.body.escalation_reason ? err.body.escalation_reason : null;
      await logger.emitEvent({
        message_id,
        timestamp: ts,
        agent: 'action_decider',
        decision: 'error',
        confidence: null,
        escalation_reason: escReason,
        tenant_id,
        details: { error: err.message }
      });
      const status = err.status === 400 ? 400 : 503;
      return res.status(status).json({ success: false, step: 'decide', error: err.message });
    }

    // 5. Act: record outcome (prototype: log only; optional notify/queue in deployment)
    await logger.emitEvent({
      message_id,
      timestamp: ts,
      agent: 'act',
      decision: action,
      confidence: null,
      escalation_reason,
      tenant_id,
      intent,
      action,
      details: queue ? { queue } : undefined
    });

    return res.status(200).json({
      success: true,
      message_id,
      tenant_id,
      intent,
      confidence,
      entities,
      action,
      escalation_reason,
      queue
    });
  } catch (err) {
    logger.error('Triage pipeline error', { error: err.message });
    await logger.emitEvent({
      message_id,
      timestamp: ts,
      agent: 'ingest',
      decision: 'error',
      confidence: null,
      escalation_reason: null,
      tenant_id,
      details: { error: err.message }
    });
    return res.status(503).json({
      success: false,
      step: 'ingest',
      error: err.message || 'AI service unavailable'
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: process.env.SERVICE_NAME || 'agentic-email-processing-system' });
});

app.listen(PORT, () => {
  logger.info(`Phase 1+3 listening on port ${PORT} (email-triage agents via AI_SERVICE_URL)`);
});
