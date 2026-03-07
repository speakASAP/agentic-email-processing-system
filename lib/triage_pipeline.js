/**
 * Runs the full triage pipeline (ingest → classify → extract → decide → act).
 * Used by POST /api/triage and by demo run; supports optional callbacks for per-stage updates.
 * Contracts: docs/contracts/ (email-schema, event-schema, intent-taxonomy, action-set).
 */

/**
 * @param {object} raw - Raw email payload (per email-schema)
 * @param {object} aiClient - { ingest, classify, extract, decide }
 * @param {object} logger - { emitEvent, error }
 * @param {{ onStageStart?: (stage: string) => void|Promise<void>, onStageEnd?: (stage: string, err: Error|null, data: object) => void|Promise<void> }} [callbacks]
 * @returns {Promise<{ success: boolean, message_id?: string, tenant_id?: string, intent?: string, confidence?: number, entities?: array, action?: string, escalation_reason?: string, queue?: string, step?: string, error?: string }>}
 */
async function runTriagePipeline(raw, aiClient, logger, callbacks = {}) {
  const ts = new Date().toISOString();
  let message_id = raw && raw.message_id != null ? String(raw.message_id) : 'unknown';
  let tenant_id = raw && raw.tenant_id != null ? String(raw.tenant_id) : '';
  const { onStageStart, onStageEnd } = callbacks;

  logger.info('Triage pipeline started', { message_id, started_at: ts });

  const fire = async (stage, fn) => {
    if (onStageStart) await Promise.resolve(onStageStart(stage));
    try {
      const result = await fn();
      if (onStageEnd) await Promise.resolve(onStageEnd(stage, null, result));
      return result;
    } catch (err) {
      if (onStageEnd) await Promise.resolve(onStageEnd(stage, err, {}));
      throw err;
    }
  };

  try {
    // 1. Ingest
    const ingestResult = await fire('ingest', () => aiClient.ingest(raw));
    if (!ingestResult.success) {
      if (onStageEnd) await Promise.resolve(onStageEnd('ingest', null, { success: false, error: ingestResult.error }));
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
      return {
        success: false,
        step: 'ingest',
        error: ingestResult.error,
        escalation_reason: ingestResult.escalation_reason || 'incomplete_data'
      };
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
      const classifyResult = await fire('classify', () => aiClient.classify({ payload }));
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
      const reason = (aiClient.getErrorReason && aiClient.getErrorReason(err)) || 'other';
      logger.error(`Triage classify error: ${reason}`, { message_id, reason, error: err.message });
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
      throw err;
    }

    // 3. Extract
    let entities = [];
    let extractSummary;
    try {
      const extractResult = await fire('extract', () => aiClient.extract({ payload, intent }));
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
      const reason = (aiClient.getErrorReason && aiClient.getErrorReason(err)) || 'other';
      logger.error(`Triage extract error: ${reason}`, { message_id, reason, error: err.message });
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
      throw err;
    }

    // 4. Decide
    let action, escalation_reason, queue;
    try {
      const decideResult = await fire('decide', () => aiClient.decide({
        intent,
        confidence,
        message_id,
        tenant_id,
        entities
      }));
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
      const reason = (aiClient.getErrorReason && aiClient.getErrorReason(err)) || 'other';
      logger.error(`Triage decide error: ${reason}`, { message_id, reason, error: err.message });
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
      throw err;
    }

    // 5. Act
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

    return {
      success: true,
      message_id,
      tenant_id,
      intent,
      confidence,
      entities,
      action,
      escalation_reason,
      queue
    };
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
    return {
      success: false,
      step: 'ingest',
      error: err.message || 'AI service unavailable'
    };
  }
}

module.exports = { runTriagePipeline };
