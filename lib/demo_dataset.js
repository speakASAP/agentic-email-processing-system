/**
 * Demo dataset: loads the 50-email sample and holds per-email workflow state in memory.
 * Single source of truth for demo is docs/sample_intent_dataset.json (read-only).
 */

const path = require('path');
const fs = require('fs');

const DATASET_PATH = path.join(__dirname, '..', 'docs', 'sample_intent_dataset.json');

const STAGES = ['ingest', 'classify', 'extract', 'decide'];
const STATUS_PENDING = 'pending';
const STATUS_RUNNING = 'running';
const STATUS_SUCCESS = 'success';
const STATUS_FAILED = 'failed';
const OVERALL_PENDING = 'pending';
const OVERALL_RUNNING = 'running';
const OVERALL_COMPLETED = 'completed';
const OVERALL_FAILED = 'failed';

/** @type {Map<string, object>} */
let byId = new Map();

/**
 * Load dataset from JSON; init per-email state. Idempotent (resets state).
 */
function load() {
  const raw = fs.readFileSync(DATASET_PATH, 'utf8');
  const items = JSON.parse(raw);
  if (!Array.isArray(items)) {
    throw new Error('Demo dataset must be a JSON array');
  }
  byId = new Map();
  for (const item of items) {
    const email = item && item.email ? item.email : item;
    const message_id = email && email.message_id != null ? String(email.message_id) : null;
    const label = item && item.label != null ? String(item.label) : '';
    if (!message_id) continue;
    byId.set(message_id, {
      message_id,
      label,
      email: { ...email },
      stages: {
        ingest: { status: STATUS_PENDING },
        classify: { status: STATUS_PENDING },
        extract: { status: STATUS_PENDING },
        decide: { status: STATUS_PENDING }
      },
      overallStatus: OVERALL_PENDING
    });
  }
  return byId.size;
}

/**
 * @returns {Array<{ message_id: string, subject: string, bodyPreview: string, status: string, category: string|null, action: string|null }>}
 */
function getList() {
  const list = [];
  for (const rec of byId.values()) {
    const sub = rec.email && rec.email.subject != null ? String(rec.email.subject) : '';
    const body = rec.email && (rec.email.body_plain || rec.email.body_html) ? (rec.email.body_plain || rec.email.body_html) : '';
    const bodyPreview = body.length > 120 ? body.slice(0, 117) + '...' : body;
    let category = null;
    let action = null;
    if (rec.stages.classify && rec.stages.classify.status === STATUS_SUCCESS && rec.stages.classify.intent) {
      category = rec.stages.classify.intent;
    }
    if (rec.stages.decide && rec.stages.decide.status === STATUS_SUCCESS && rec.stages.decide.action) {
      action = rec.stages.decide.action;
    }
    list.push({
      message_id: rec.message_id,
      subject: sub,
      bodyPreview: bodyPreview,
      status: rec.overallStatus,
      category,
      action
    });
  }
  return list;
}

/**
 * @param {string} message_id
 * @returns {object|null}
 */
function get(message_id) {
  return byId.get(message_id) || null;
}

/**
 * @returns {string[]}
 */
function getMessageIds() {
  return Array.from(byId.keys());
}

function setStageRunning(message_id, stage) {
  const rec = byId.get(message_id);
  if (!rec || !STAGES.includes(stage)) return;
  rec.stages[stage] = { ...rec.stages[stage], status: STATUS_RUNNING };
  rec.overallStatus = OVERALL_RUNNING;
}

function setStageResult(message_id, stage, status, data = {}) {
  const rec = byId.get(message_id);
  if (!rec || !STAGES.includes(stage)) return;
  if (status === 'pending') {
    rec.stages[stage] = { status: STATUS_PENDING };
    return;
  }
  const base = {
    status: status === 'success' ? STATUS_SUCCESS : STATUS_FAILED,
    error: data.error || null
  };
  Object.assign(base, stage === 'ingest' && { payload: data.payload },
    stage === 'classify' && { intent: data.intent, confidence: data.confidence, raw_scores: data.raw_scores },
    stage === 'extract' && { message_id: data.message_id, entities: data.entities, summary: data.summary },
    stage === 'decide' && { action: data.action, escalation_reason: data.escalation_reason, queue: data.queue });
  rec.stages[stage] = base;
}

function setOverallStatus(message_id, status) {
  const rec = byId.get(message_id);
  if (!rec) return;
  rec.overallStatus = status;
}

/**
 * Update email payload for one message (in-memory only; for realtime testing).
 * Resets all stages to pending so next run uses new content.
 * @param {string} message_id
 * @param {object} payload - Fields to merge into rec.email (subject, sender, body_plain, body_html, etc.)
 * @returns {boolean}
 */
function updateEmail(message_id, payload) {
  const rec = byId.get(message_id);
  if (!rec || !payload || typeof payload !== 'object') return false;
  const allowed = ['subject', 'sender', 'recipients', 'body_plain', 'body_html', 'locale', 'metadata', 'attachments', 'timestamp', 'tenant_id'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      rec.email[key] = payload[key];
    }
  }
  rec.overallStatus = OVERALL_PENDING;
  for (const stage of STAGES) {
    rec.stages[stage] = { status: STATUS_PENDING };
  }
  return true;
}

/** Ensure dataset loaded on first use. */
function ensureLoaded() {
  if (byId.size === 0) load();
}

module.exports = {
  load,
  getList,
  get,
  getMessageIds,
  setStageRunning,
  setStageResult,
  setOverallStatus,
  updateEmail,
  ensureLoaded,
  STAGES,
  STATUS_PENDING,
  STATUS_RUNNING,
  STATUS_SUCCESS,
  STATUS_FAILED,
  OVERALL_PENDING,
  OVERALL_RUNNING,
  OVERALL_COMPLETED,
  OVERALL_FAILED
};
