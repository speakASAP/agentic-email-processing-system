/**
 * Runs the full triage pipeline (ingest → classify → extract → decide → act).
 * Used by POST /api/triage and by app run (test dataset); supports optional callbacks for per-stage updates.
 * Contracts: docs/contracts/ (email-schema, event-schema, intent-taxonomy, action-set).
 */

/**
 * @param {object} raw - Raw email payload (per email-schema)
 * @param {object} aiClient - { ingest, classify, extract, decide }
 * @param {object} logger - { emitEvent, error }
 * @param {{ onStageStart?: (stage: string) => void|Promise<void>, onStageEnd?: (stage: string, err: Error|null, data: object) => void|Promise<void> }} [callbacks]
 * @param {{ useLlmClassifier?: boolean, useLlmDecider?: boolean }} [options] - When set, passed as use_llm to ai-microservice classify/decide (compare AI vs rule-based)
 * @returns {Promise<{ success: boolean, message_id?: string, tenant_id?: string, intent?: string, confidence?: number, entities?: array, action?: string, escalation_reason?: string, queue?: string, step?: string, error?: string }>}
 */
async function runTriagePipeline(raw, aiClient, logger, callbacks = {}, options = {}) {
  const ts = new Date().toISOString();
  let message_id = raw && raw.message_id != null ? String(raw.message_id) : 'unknown';
  let tenant_id = raw && raw.tenant_id != null ? String(raw.tenant_id) : '';
  const { onStageStart, onStageEnd } = callbacks;
  // Explicit booleans so ai-microservice receives use_llm and uses OpenRouter when true
  const useLlmClassifier = options.useLlmClassifier === true || options.useLlmClassifier === 'true' || options.useLlmClassifier === 1;
  const useLlmDecider = options.useLlmDecider === true || options.useLlmDecider === 'true' || options.useLlmDecider === 1;

  logger.info('Triage pipeline started', {
    message_id,
    started_at: ts,
    useLlmClassifier,
    useLlmDecider,
    options_raw: { useLlmClassifier: options.useLlmClassifier, useLlmDecider: options.useLlmDecider }
  });

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

  /** Stage that threw last; used so final "Triage run failed" reports the actual failing stage. */
  let failedStage = 'ingest';

  try {
    // 1. Ingest
    const ingestResult = await fire('ingest', () => aiClient.ingest(raw));
    if (!ingestResult.success) {
      if (onStageEnd) await Promise.resolve(onStageEnd('ingest', null, { success: false, error: ingestResult.error }));
      logger.emitEvent({
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
    logger.emitEvent({
      message_id,
      timestamp: ts,
      agent: 'ingest',
      decision: 'accepted',
      confidence: null,
      escalation_reason: null,
      tenant_id
    });

    // 2. Classify
    failedStage = 'classify';
    let intent, confidence, raw_scores;
    try {
      const classifyBody = { payload, use_llm: useLlmClassifier };
      logger.info('Classify request body (use_llm)', { message_id, use_llm: classifyBody.use_llm, has_payload: !!payload });
      const classifyResult = await fire('classify', () => aiClient.classify(classifyBody));
      logger.info('Classify response (model_used)', { message_id, model_used: classifyResult.model_used, useLlmClassifier });
      if (useLlmClassifier && (classifyResult.model_used === 'rule-based' || !classifyResult.model_used || String(classifyResult.model_used).toLowerCase() === 'rule-based')) {
        logger.error('LLM requested but classifier returned rule-based — parameter lost or ai-microservice fallback', {
          message_id,
          useLlmClassifier,
          model_used: classifyResult.model_used,
          point: 'triage_pipeline_after_classify'
        });
        throw new Error('LLM requested but classifier returned rule-based; check ai-microservice FREE_AI_SERVICE_URL and logs');
      }
      intent = classifyResult.intent;
      confidence = classifyResult.confidence;
      raw_scores = classifyResult.raw_scores;
      const classifyDetails = raw_scores ? { raw_scores } : {};
      if (classifyResult.model_used != null) classifyDetails.model_used = classifyResult.model_used;
      if (classifyResult.llm_output != null) classifyDetails.llm_output = classifyResult.llm_output;
      logger.emitEvent({
        message_id,
        timestamp: ts,
        agent: 'classifier',
        decision: intent,
        confidence,
        escalation_reason: null,
        tenant_id,
        intent,
        details: Object.keys(classifyDetails).length ? classifyDetails : undefined
      });
    } catch (err) {
      const reason = (aiClient.getErrorReason && aiClient.getErrorReason(err)) || 'other';
      logger.error(`Triage classify error: ${reason}`, { message_id, reason, error: err.message });
      const escReason = err.status === 400 && err.body && err.body.escalation_reason ? err.body.escalation_reason : null;
      logger.emitEvent({
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
    failedStage = 'extract';
    let entities = [];
    let extractSummary;
    try {
      const extractResult = await fire('extract', () => aiClient.extract({ payload, intent }));
      entities = extractResult.entities || [];
      extractSummary = extractResult.summary;
      logger.emitEvent({
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
      throw err;
    }

    // 4. Decide
    failedStage = 'decide';
    let action, escalation_reason, queue;
    try {
      const decideBody = { intent, confidence, message_id, tenant_id, entities, use_llm: useLlmDecider };
      logger.info('Decide request body (use_llm)', { message_id, use_llm: decideBody.use_llm, useLlmDecider });
      const decideResult = await fire('decide', () => aiClient.decide(decideBody));
      logger.info('Decide response (model_used)', { message_id, model_used: decideResult.model_used, useLlmDecider });
      if (useLlmDecider && (decideResult.model_used === 'rule-based' || !decideResult.model_used || String(decideResult.model_used).toLowerCase() === 'rule-based')) {
        logger.error('LLM requested but decider returned rule-based — parameter lost or ai-microservice fallback', {
          message_id,
          useLlmDecider,
          model_used: decideResult.model_used,
          point: 'triage_pipeline_after_decide'
        });
        throw new Error('LLM requested but decider returned rule-based; check ai-microservice FREE_AI_SERVICE_URL and logs');
      }
      action = decideResult.action;
      escalation_reason = decideResult.escalation_reason || null;
      queue = decideResult.queue || null;
      const decideDetails = queue ? { queue } : {};
      if (decideResult.model_used != null) decideDetails.model_used = decideResult.model_used;
      if (decideResult.llm_output != null) decideDetails.llm_output = decideResult.llm_output;
      logger.emitEvent({
        message_id,
        timestamp: ts,
        agent: 'action_decider',
        decision: action,
        confidence: null,
        escalation_reason,
        tenant_id,
        action,
        details: Object.keys(decideDetails).length ? decideDetails : undefined
      });
    } catch (err) {
      const reason = (aiClient.getErrorReason && aiClient.getErrorReason(err)) || 'other';
      logger.error(`Triage decide error: ${reason}`, { message_id, reason, error: err.message });
      const escReason = err.status === 400 && err.body && err.body.escalation_reason ? err.body.escalation_reason : null;
      logger.emitEvent({
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
    logger.emitEvent({
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
    logger.error('Triage pipeline error', { error: err.message, step: failedStage });
    logger.emitEvent({
      message_id,
      timestamp: ts,
      agent: failedStage === 'ingest' ? 'ingest' : failedStage === 'classify' ? 'classifier' : failedStage === 'extract' ? 'extractor' : 'action_decider',
      decision: 'error',
      confidence: null,
      escalation_reason: null,
      tenant_id,
      details: { error: err.message }
    });
    return {
      success: false,
      step: failedStage,
      error: err.message || 'AI service unavailable'
    };
  }
}

module.exports = { runTriagePipeline };
