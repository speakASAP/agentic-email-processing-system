/**
 * Centralized logger for Agentic Email Processing System.
 * Sends logs to LOGGING_SERVICE_URL; event-schema fields in metadata for audit.
 */

const LOGGING_SERVICE_URL = process.env.LOGGING_SERVICE_URL || '';
const SERVICE_NAME = process.env.SERVICE_NAME || 'agentic-email-processing-system';
const API_PATH = process.env.LOGGING_SERVICE_API_PATH || '/api/logs';

const STARTED_AT = Date.now();
const LOGGING_GRACE_MS = 30000; // During startup grace, log to console only so deploy healthcheck isn't slowed by timeouts

async function sendLog(level, message, metadata = {}) {
  const ts = new Date().toISOString();
  const toConsole = () => {
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
      `[${ts}] [${level}] [${SERVICE_NAME}] ${message}`,
      Object.keys(metadata).length ? metadata : ''
    );
  };
  if (!LOGGING_SERVICE_URL) {
    toConsole();
    return;
  }
  if (Date.now() - STARTED_AT < LOGGING_GRACE_MS) {
    toConsole();
    return;
  }
  try {
    const payload = {
      level: level === 'warning' ? 'warn' : level,
      message,
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      metadata: { ...metadata }
    };
    const res = await fetch(`${LOGGING_SERVICE_URL.replace(/\/$/, '')}${API_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000)
    });
    if (!res.ok) throw new Error(`Logging service ${res.status}`);
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || /timeout|timed out/i.test(String(err.message || ''));
    if (isTimeout) {
      console.error(`[${SERVICE_NAME}] ERROR: Logging service request timeout (connectivity or slow) –`, err.message);
    } else {
      console.error(`[${SERVICE_NAME}] ERROR: Logging service failed:`, err.message);
    }
  }
}

/**
 * Emit an audit event per docs/contracts/event-schema.md.
 * Fire-and-forget: does not block the pipeline; never throws.
 * @param {object} event - message_id, timestamp, agent, decision, confidence?, escalation_reason?, tenant_id?, intent?, action?, details?
 */
function emitEvent(event) {
  const message = `[event] ${event.agent} ${event.decision}`;
  sendLog('info', message, {
    message_id: event.message_id,
    timestamp: event.timestamp || new Date().toISOString(),
    agent: event.agent,
    decision: event.decision,
    confidence: event.confidence ?? null,
    escalation_reason: event.escalation_reason ?? null,
    tenant_id: event.tenant_id,
    intent: event.intent,
    action: event.action,
    details: event.details
  }).catch((err) => {
    console.error(`[${SERVICE_NAME}] emitEvent failed:`, err.message);
  });
}

module.exports = {
  sendLog,
  emitEvent,
  info: (msg, meta) => sendLog('info', msg, meta),
  warn: (msg, meta) => sendLog('warn', msg, meta),
  error: (msg, meta) => sendLog('error', msg, meta),
  emitEvent
};
