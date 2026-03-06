/**
 * Demo UI: list 50 emails, detail view with stage stepper, short polling for live updates.
 */

const API = '/api/demo';
const POLL_INTERVAL_MS = 1500;

let allEmails = [];
let categories = new Set();
let selectedId = null;
let pollTimer = null;

function $(id) { return document.getElementById(id); }

function fetchJson(path) {
  return fetch(path).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); });
}

function listEmails() {
  return fetchJson(`${API}/emails`).then(data => data.emails || []);
}

function getEmail(id) {
  return fetchJson(`${API}/emails/${encodeURIComponent(id)}`);
}

function runOne(id) {
  return fetch(`${API}/emails/${encodeURIComponent(id)}/run`, { method: 'POST' }).then(r => {
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  });
}

function runAll() {
  return fetch(`${API}/run-all`, { method: 'POST' }).then(r => {
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  });
}

function applyFilters() {
  const statusFilter = ($('filter-status') && $('filter-status').value) || '';
  const categoryFilter = ($('filter-category') && $('filter-category').value) || '';
  return allEmails.filter(e => {
    if (statusFilter && e.status !== statusFilter) return false;
    if (categoryFilter && e.category !== categoryFilter) return false;
    return true;
  });
}

function renderList() {
  const list = $('email-list');
  if (!list) return;
  const filtered = applyFilters();
  list.innerHTML = filtered.map(e => `
    <li class="email-card" data-id="${e.message_id}">
      <div class="subject">${escapeHtml(e.subject || '(no subject)')}</div>
      <div class="preview">${escapeHtml(e.bodyPreview || '')}</div>
      <div class="meta">
        <span class="status ${e.status}">${e.status}</span>
        ${e.category ? `<span>Category: ${escapeHtml(e.category)}</span>` : ''}
        ${e.action ? `<span>Action: ${escapeHtml(e.action)}</span>` : ''}
      </div>
    </li>
  `).join('');
  list.querySelectorAll('.email-card').forEach(el => {
    el.addEventListener('click', () => selectEmail(el.dataset.id));
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function fillCategoryFilter() {
  const sel = $('filter-category');
  if (!sel) return;
  const opts = ['<option value="">All</option>'];
  [...categories].sort().forEach(c => { opts.push(`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`); });
  sel.innerHTML = opts.join('');
}

function refreshList() {
  listEmails()
    .then(emails => {
      allEmails = emails;
      emails.forEach(e => { if (e.category) categories.add(e.category); });
      fillCategoryFilter();
      renderList();
    })
    .catch(err => { $('email-list').innerHTML = `<li class="empty">Failed to load: ${escapeHtml(err.message)}</li>`; });
}

function renderDetail(rec) {
  const content = $('detail-content');
  if (!content) return;
  const s = rec.stages || {};
  const stages = [
    { key: 'ingest', title: 'Ingest', data: s.ingest },
    { key: 'classify', title: 'Classify', data: s.classify },
    { key: 'extract', title: 'Extract', data: s.extract },
    { key: 'decide', title: 'Decide', data: s.decide }
  ];
  const body = (rec.email && (rec.email.body_plain || rec.email.body_html)) ? (rec.email.body_plain || rec.email.body_html) : '';
  const stageHtml = stages.map(st => {
    const d = st.data || {};
    const status = d.status || 'pending';
    let io = '';
    if (status === 'success' || status === 'failed') {
      if (st.key === 'ingest' && d.payload) io = JSON.stringify(d.payload, null, 2);
      if (st.key === 'classify') io = [d.intent != null && `Intent: ${d.intent}`, d.confidence != null && `Confidence: ${d.confidence}`].filter(Boolean).join('\n');
      if (st.key === 'extract' && d.entities) io = JSON.stringify(d.entities, null, 2);
      if (st.key === 'decide') io = [d.action && `Action: ${d.action}`, d.queue && `Queue: ${d.queue}`, d.escalation_reason && `Escalation: ${d.escalation_reason}`].filter(Boolean).join('\n');
    }
    return `
      <div class="stage" data-stage="${st.key}">
        <div class="name">${escapeHtml(st.title)} <span class="badge ${status}">${status}</span></div>
        ${d.error ? `<div class="error">${escapeHtml(d.error)}</div>` : ''}
        ${io ? `<div class="io"><pre>${escapeHtml(io)}</pre></div>` : ''}
      </div>`;
  }).join('');

  const decide = s.decide || {};
  const classify = s.classify || {};
  const category = classify.intent ? classify.intent : null;
  const confidence = classify.confidence != null ? classify.confidence : null;
  // Explanation trail: one-line summary of how the final decision was reached (master-prompt: "clear explanation trail")
  let explanationLine = '';
  if (decide.status === 'success') {
    if (decide.escalation_reason) {
      explanationLine = `Escalated: ${escapeHtml(decide.escalation_reason)}${decide.queue ? ` → ${escapeHtml(decide.queue)}` : ''}.`;
    } else if (decide.action && decide.queue) {
      explanationLine = `Routed to ${escapeHtml(decide.queue)} (action: ${escapeHtml(decide.action)}).`;
    } else if (decide.action) {
      explanationLine = `Action: ${escapeHtml(decide.action)}.`;
    }
    if (confidence != null && category) {
      explanationLine = (explanationLine ? explanationLine + ' ' : '') + `Category "${escapeHtml(category)}" (confidence ${Number(confidence).toFixed(2)}).`;
    }
  } else if (decide.status === 'failed' && decide.error) {
    explanationLine = `Decision failed: ${escapeHtml(decide.error)}.`;
  }
  content.innerHTML = `
    <div class="detail-email">
      <div class="subject">${escapeHtml(rec.email && rec.email.subject || '(no subject)')}</div>
      <div class="from">From: ${escapeHtml(rec.email && rec.email.sender || '')}</div>
      <div class="body">${escapeHtml(body)}</div>
    </div>
    <div class="stages">${stageHtml}</div>
    <div class="final">
      ${explanationLine ? `<div class="explanation">${explanationLine}</div>` : ''}
      ${category ? `<div class="category">Category: ${escapeHtml(category)}</div>` : ''}
      ${decide.action ? `<div class="action">Action: ${escapeHtml(decide.action)}</div>` : ''}
      ${decide.escalation_reason ? `<div class="escalation">Escalation: ${escapeHtml(decide.escalation_reason)}</div>` : ''}
    </div>`;
}

function selectEmail(id) {
  selectedId = id;
  $('list-section').setAttribute('hidden', '');
  $('detail-section').removeAttribute('hidden');
  loadDetail(id);
}

function loadDetail(id) {
  getEmail(id).then(rec => { renderDetail(rec); }).catch(() => { renderDetail({ email: {}, stages: {} }); });
}

function backToList() {
  selectedId = null;
  $('detail-section').setAttribute('hidden', '');
  $('list-section').removeAttribute('hidden');
  refreshList();
}

function startPolling() {
  if (pollTimer) return;
  $('poll-status').textContent = 'Polling…';
  pollTimer = setInterval(() => {
    refreshList();
    if (selectedId) loadDetail(selectedId);
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  $('poll-status').textContent = '';
}

function onRunOne() {
  if (!selectedId) return;
  const btn = $('run-one');
  if (btn) btn.disabled = true;
  runOne(selectedId).then(() => { startPolling(); if (btn) btn.disabled = false; }).catch(err => { alert(err.message); if (btn) btn.disabled = false; });
}

function onRunAll() {
  const btn = $('run-all');
  if (btn) btn.disabled = true;
  runAll().then(() => { startPolling(); if (btn) btn.disabled = false; }).catch(err => { alert(err.message); if (btn) btn.disabled = false; });
}

function init() {
  refreshList();
  if ($('back')) $('back').addEventListener('click', backToList);
  if ($('run-one')) $('run-one').addEventListener('click', onRunOne);
  if ($('run-all')) $('run-all').addEventListener('click', onRunAll);
  if ($('filter-status')) $('filter-status').addEventListener('change', renderList);
  if ($('filter-category')) $('filter-category').addEventListener('change', renderList);
}

init();
