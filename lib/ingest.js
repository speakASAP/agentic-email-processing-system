/**
 * Ingest Agent: validate and normalize per docs/contracts/email-schema.md.
 * Canonical implementation is in ai-microservice (POST /api/email-triage/ingest).
 * This file is kept for reference only; server.js uses ai-microservice.
 */

const MAX_ITEMS = 30;

/**
 * @param {object} raw - Raw incoming payload
 * @returns {{ valid: boolean, normalized?: object, error?: string, escalation_reason?: string }}
 */
function validateAndNormalize(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Payload must be an object', escalation_reason: 'incomplete_data' };
  }

  const message_id = raw.message_id != null ? String(raw.message_id).trim() : '';
  const tenant_id = raw.tenant_id != null ? String(raw.tenant_id).trim() : '';
  const timestamp = raw.timestamp;

  if (!message_id) {
    return { valid: false, error: 'message_id is required', escalation_reason: 'incomplete_data' };
  }
  if (!tenant_id) {
    return { valid: false, error: 'tenant_id is required', escalation_reason: 'incomplete_data' };
  }
  if (timestamp === undefined || timestamp === null) {
    return { valid: false, error: 'timestamp is required', escalation_reason: 'incomplete_data' };
  }

  const body_plain = raw.body_plain != null ? String(raw.body_plain) : '';
  const body_html = raw.body_html != null ? String(raw.body_html) : '';
  if (!body_plain && !body_html) {
    return { valid: false, error: 'At least one of body_plain or body_html is required', escalation_reason: 'incomplete_data' };
  }

  let recipients = raw.recipients;
  if (Array.isArray(recipients)) {
    if (recipients.length > MAX_ITEMS) {
      return { valid: false, error: `recipients length must be ≤ ${MAX_ITEMS}`, escalation_reason: 'incomplete_data' };
    }
  } else {
    recipients = [];
  }

  let attachments = raw.attachments;
  if (Array.isArray(attachments)) {
    if (attachments.length > MAX_ITEMS) {
      return { valid: false, error: `attachments length must be ≤ ${MAX_ITEMS}`, escalation_reason: 'incomplete_data' };
    }
  } else {
    attachments = [];
  }

  const normalized = {
    message_id,
    tenant_id,
    timestamp: typeof timestamp === 'number' ? timestamp : String(timestamp),
    sender: raw.sender != null ? String(raw.sender) : '',
    recipients,
    subject: raw.subject != null ? String(raw.subject) : '',
    body_plain: body_plain || '',
    body_html: body_html || '',
    attachments,
    locale: raw.locale != null ? String(raw.locale) : undefined,
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : undefined
  };

  return { valid: true, normalized };
}

module.exports = { validateAndNormalize, MAX_ITEMS };
