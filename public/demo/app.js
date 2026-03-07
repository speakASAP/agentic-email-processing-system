/**
 * Demo UI: list 50 emails, detail view with stage stepper, short polling for live updates.
 */

const API = '/api/demo';
const POLL_INTERVAL_MS = 1500;

let allEmails = [];
let categories = new Set();
let selectedId = null;
let pollTimer = null;
let selectedStatus = '';
let selectedCategory = '';
let expandedStages = {};
let cachedLogs = null;
let cachedLogsMessageId = null;

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

function updateEmail(id, payload) {
  return fetch(`${API}/emails/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: payload })
  }).then(r => {
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  });
}

function fetchDemoLogs(messageId) {
  return fetchJson(`${API}/emails/${encodeURIComponent(messageId)}/logs`).then(data => data.logs || []);
}

function applyFilters() {
  return allEmails.filter(e => {
    if (selectedStatus && e.status !== selectedStatus) return false;
    if (selectedCategory && e.category !== selectedCategory) return false;
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

function setActiveFilterBtn(container, dataAttr, value) {
  if (!container) return;
  container.querySelectorAll('.filter-btn').forEach(btn => {
    const val = btn.getAttribute(dataAttr);
    btn.classList.toggle('active', (val || '') === (value || ''));
  });
}

function fillCategoryFilter() {
  const container = $('filter-category-btns');
  if (!container) return;
  const parts = ['<button type="button" class="filter-btn' + (selectedCategory ? '' : ' active') + '" data-category="">All</button>'];
  [...categories].sort().forEach(c => {
    parts.push('<button type="button" class="filter-btn' + (selectedCategory === c ? ' active' : '') + '" data-category="' + escapeHtml(c) + '">' + escapeHtml(c) + '</button>');
  });
  container.innerHTML = parts.join('');
  container.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCategory = btn.getAttribute('data-category') || '';
      setActiveFilterBtn(container, 'data-category', selectedCategory);
      renderList();
    });
  });
}

function refreshList() {
  return listEmails()
    .then(emails => {
      allEmails = emails;
      emails.forEach(e => { if (e.category) categories.add(e.category); });
      fillCategoryFilter();
      renderList();
    })
    .catch(err => {
      $('email-list').innerHTML = `<li class="empty">Failed to load: ${escapeHtml(err.message)}</li>`;
      throw err;
    });
}

function getStageRequest(rec, key) {
  const s = rec.stages || {};
  const email = rec.email || {};
  if (key === 'ingest') return email.subject != null || email.sender != null ? { subject: email.subject, sender: email.sender, body_plain: email.body_plain, body_html: email.body_html } : null;
  if (key === 'classify' && s.ingest && s.ingest.payload) return s.ingest.payload;
  if (key === 'extract') return { payload: (s.ingest && s.ingest.payload) || null, intent: (s.classify && s.classify.intent) != null ? s.classify.intent : null };
  if (key === 'decide') return { intent: (s.classify && s.classify.intent) != null ? s.classify.intent : null, confidence: (s.classify && s.classify.confidence) != null ? s.classify.confidence : null, entities: (s.extract && s.extract.entities) != null ? s.extract.entities : null };
  return null;
}

function getStageResponse(st) {
  const d = st.data || {};
  const status = d.status || 'pending';
  if (status !== 'success' && status !== 'failed') return null;
  if (st.key === 'ingest' && d.payload) return d.payload;
  if (st.key === 'classify') return { intent: d.intent, confidence: d.confidence, raw_scores: d.raw_scores != null && typeof d.raw_scores === 'object' ? d.raw_scores : {} };
  if (st.key === 'extract') return { message_id: d.message_id, entities: d.entities != null ? d.entities : { product_refs: [], amounts: [], dates: [], contract_refs: [] }, summary: d.summary };
  if (st.key === 'decide') return { action: d.action, queue: d.queue, escalation_reason: d.escalation_reason };
  return null;
}

function renderDetail(rec) {
  const content = $('detail-content');
  if (!content) return;
  const messageId = rec.email && rec.email.message_id ? String(rec.email.message_id) : selectedId || '';
  if (messageId && cachedLogsMessageId !== messageId) {
    cachedLogs = null;
    cachedLogsMessageId = null;
  }
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
    const isExpanded = !!expandedStages[st.key];
    return `
      <div class="stage stage-expandable" data-stage="${st.key}">
        <div class="stage-header" role="button" tabindex="0" aria-expanded="${isExpanded}">
          <span class="stage-chevron" aria-hidden="true">${isExpanded ? '▼' : '▶'}</span>
          <div class="name">${escapeHtml(st.title)} <span class="badge ${status}">${status}</span></div>
        </div>
        <div class="stage-body${isExpanded ? '' : ' stage-body-collapsed'}" data-stage="${st.key}">
          ${d.error ? `<div class="error">${escapeHtml(d.error)}</div>` : ''}
          ${st.key === 'classify' ? `<div class="stage-details"><div class="stage-label">Details</div><div class="classify-details">Intent: ${escapeHtml(String(d.intent != null ? d.intent : '—'))}, Confidence: ${d.confidence != null ? Number(d.confidence).toFixed(2) : '—'}${d.raw_scores && typeof d.raw_scores === 'object' && Object.keys(d.raw_scores).length ? '. Raw scores: ' + Object.entries(d.raw_scores).map(([k, v]) => k + '=' + Number(v).toFixed(2)).join(', ') : ''}</div></div>` : ''}
          ${st.key === 'extract' && d.entities ? (function(e){ if (!e || typeof e !== 'object') return ''; const empty = (!e.product_refs || e.product_refs.length===0) && (!e.amounts || e.amounts.length===0) && (!e.dates || e.dates.length===0) && (!e.contract_refs || e.contract_refs.length===0); return empty ? '<div class="stage-extract-note">No product refs, amounts, dates or contract refs found (extractor looks for these patterns in the email).</div>' : ''; })(d.entities) : ''}
          <div class="stage-request"><div class="stage-label">Request</div><pre class="stage-pre"></pre></div>
          <div class="stage-response"><div class="stage-label">Response</div><pre class="stage-pre"></pre></div>
          <div class="stage-logs"><div class="stage-label">Logs</div><div class="stage-logs-content">—</div></div>
        </div>
      </div>`;
  }).join('');

  const decide = s.decide || {};
  const classify = s.classify || {};
  const category = classify.intent ? classify.intent : null;
  const confidence = classify.confidence != null ? classify.confidence : null;
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

  stages.forEach(st => {
    const stageEl = content.querySelector(`.stage[data-stage="${st.key}"]`);
    const headerEl = stageEl && stageEl.querySelector('.stage-header');
    const bodyEl = stageEl && stageEl.querySelector('.stage-body');
    if (!stageEl || !headerEl || !bodyEl) return;
    if (expandedStages[st.key]) {
      fillStageBody(rec, st, bodyEl, messageId);
    }
    headerEl.addEventListener('click', () => toggleStage(rec, st.key, messageId));
    headerEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStage(rec, st.key, messageId); } });
  });
}

function fillStageBody(rec, st, bodyEl, messageId) {
  const requestObj = getStageRequest(rec, st.key);
  const responseObj = getStageResponse(st);
  const reqPre = bodyEl.querySelector('.stage-request pre');
  const resPre = bodyEl.querySelector('.stage-response pre');
  const logsContent = bodyEl.querySelector('.stage-logs-content');
  if (reqPre) reqPre.textContent = requestObj != null ? JSON.stringify(requestObj, null, 2) : '—';
  if (resPre) resPre.textContent = responseObj != null ? JSON.stringify(responseObj, null, 2) : '—';
  if (logsContent) {
    if (cachedLogsMessageId === messageId && cachedLogs !== null) {
      logsContent.innerHTML = cachedLogs.length ? cachedLogs.map((entry) => {
        const ts = entry.timestamp ? new Date(entry.timestamp).toISOString() : '—';
        const level = escapeHtml(entry.level || '');
        const msg = escapeHtml(entry.message || '');
        const meta = entry.metadata && Object.keys(entry.metadata).length ? escapeHtml(JSON.stringify(entry.metadata, null, 2)) : '';
        return `<div class="logs-line"><div class="logs-meta">${ts} · ${level}</div><div class="logs-msg">${msg}</div>${meta ? `<div class="logs-meta">${meta}</div>` : ''}</div>`;
      }).join('') : '<span class="logs-empty">No log lines for this email.</span>';
    } else {
      logsContent.textContent = 'Loading…';
      fetchDemoLogs(messageId).then((logs) => {
        cachedLogs = logs;
        cachedLogsMessageId = messageId;
        if (logsContent.textContent === 'Loading…') {
          logsContent.innerHTML = logs.length ? logs.map((entry) => {
            const ts = entry.timestamp ? new Date(entry.timestamp).toISOString() : '—';
            const level = escapeHtml(entry.level || '');
            const msg = escapeHtml(entry.message || '');
            const meta = entry.metadata && Object.keys(entry.metadata).length ? escapeHtml(JSON.stringify(entry.metadata, null, 2)) : '';
            return `<div class="logs-line"><div class="logs-meta">${ts} · ${level}</div><div class="logs-msg">${msg}</div>${meta ? `<div class="logs-meta">${meta}</div>` : ''}</div>`;
          }).join('') : '<span class="logs-empty">No log lines for this email.</span>';
        }
      }).catch((err) => {
        logsContent.innerHTML = `<span class="logs-empty">Failed to load logs: ${escapeHtml(err.message)}</span>`;
      });
    }
  }
}

function toggleStage(rec, key, messageId) {
  expandedStages[key] = !expandedStages[key];
  const content = $('detail-content');
  if (!content) return;
  const stageEl = content.querySelector(`.stage[data-stage="${key}"]`);
  const headerEl = stageEl && stageEl.querySelector('.stage-header');
  const bodyEl = stageEl && stageEl.querySelector('.stage-body');
  const chevron = stageEl && stageEl.querySelector('.stage-chevron');
  const st = [{ key: 'ingest', title: 'Ingest', data: (rec.stages || {}).ingest }, { key: 'classify', title: 'Classify', data: (rec.stages || {}).classify }, { key: 'extract', title: 'Extract', data: (rec.stages || {}).extract }, { key: 'decide', title: 'Decide', data: (rec.stages || {}).decide }].find(x => x.key === key);
  if (!stageEl || !headerEl || !bodyEl) return;
  if (expandedStages[key]) {
    bodyEl.classList.remove('stage-body-collapsed');
    if (chevron) chevron.textContent = '▼';
    headerEl.setAttribute('aria-expanded', 'true');
    fillStageBody(rec, st, bodyEl, messageId);
  } else {
    bodyEl.classList.add('stage-body-collapsed');
    if (chevron) chevron.textContent = '▶';
    headerEl.setAttribute('aria-expanded', 'false');
  }
}

function selectEmail(id) {
  selectedId = id;
  expandedStages = {};
  cachedLogs = null;
  cachedLogsMessageId = null;
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
  refreshList().catch(() => {});
}

function startPolling() {
  if (pollTimer) return;
  $('poll-status').textContent = 'Polling…';
  pollTimer = setInterval(() => {
    refreshList()
      .then(() => {
        const anyRunning = allEmails.some(e => e.status === 'running');
        if (!anyRunning) {
          stopPolling();
          return;
        }
        if (selectedId) {
          return getEmail(selectedId).then(rec => { renderDetail(rec); });
        }
      })
      .catch(() => { stopPolling(); });
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

// --- Edit modal: select email then edit form ---
function openEditModal() {
  const modal = $('edit-modal');
  const stepSelect = $('edit-step-select');
  const stepForm = $('edit-step-form');
  if (!modal || !stepSelect || !stepForm) return;
  stepSelect.removeAttribute('hidden');
  stepForm.setAttribute('hidden', '');
  const listEl = $('edit-email-pick-list');
  if (listEl) {
    listEl.innerHTML = allEmails.length ? allEmails.map(e => `
      <li data-id="${escapeHtml(e.message_id)}">
        <div class="pick-subject">${escapeHtml(e.subject || '(no subject)')}</div>
        <div class="pick-id">${escapeHtml(e.message_id)}</div>
      </li>
    `).join('') : '<li class="empty">No emails loaded.</li>';
    listEl.querySelectorAll('li[data-id]').forEach(li => {
      li.addEventListener('click', () => {
        const id = li.getAttribute('data-id');
        if (!id) return;
        getEmail(id).then(rec => {
          const email = rec.email || {};
          $('edit-message-id').value = id;
          $('edit-subject').value = email.subject || '';
          $('edit-sender').value = email.sender || '';
          $('edit-body').value = email.body_plain || email.body_html || '';
          stepSelect.setAttribute('hidden', '');
          stepForm.removeAttribute('hidden');
        }).catch(() => {});
      });
    });
  }
  modal.removeAttribute('hidden');
}

function closeEditModal() {
  const modal = $('edit-modal');
  if (modal) modal.setAttribute('hidden', '');
}

function onEditBack() {
  $('edit-step-form').setAttribute('hidden', '');
  $('edit-step-select').removeAttribute('hidden');
}

function onEditSave() {
  const messageId = $('edit-message-id').value;
  if (!messageId) return;
  const payload = {
    subject: $('edit-subject').value.trim() || undefined,
    sender: $('edit-sender').value.trim() || undefined,
    body_plain: $('edit-body').value
  };
  const btn = $('edit-save');
  if (btn) btn.disabled = true;
  updateEmail(messageId, payload)
    .then(() => {
      closeEditModal();
      refreshList().then(() => { if (selectedId === messageId) loadDetail(messageId); });
    })
    .catch(err => { alert(err.message); })
    .finally(() => { if (btn) btn.disabled = false; });
}

// --- Logs modal: show every log line for this email (micro task) ---
function openLogsModal(messageId) {
  const modal = $('logs-modal');
  const content = $('logs-content');
  if (!modal || !content) return;
  content.textContent = 'Loading…';
  modal.removeAttribute('hidden');
  fetchDemoLogs(messageId)
    .then((logs) => {
      if (!logs.length) {
        content.innerHTML = '<span class="logs-empty">No log lines found for this email. Run triage first or check LOGGING_SERVICE_URL.</span>';
        return;
      }
      content.innerHTML = logs.map((entry) => {
        const ts = entry.timestamp ? new Date(entry.timestamp).toISOString() : '—';
        const level = escapeHtml(entry.level || '');
        const msg = escapeHtml(entry.message || '');
        const meta = entry.metadata && Object.keys(entry.metadata).length
          ? escapeHtml(JSON.stringify(entry.metadata, null, 2))
          : '';
        return `<div class="logs-line"><div class="logs-meta">${ts} · ${level}</div><div class="logs-msg">${msg}</div>${meta ? `<div class="logs-meta">${meta}</div>` : ''}</div>`;
      }).join('');
    })
    .catch((err) => {
      content.innerHTML = `<span class="logs-empty">Failed to load logs: ${escapeHtml(err.message)}</span>`;
    });
}

function closeLogsModal() {
  const modal = $('logs-modal');
  if (modal) modal.setAttribute('hidden', '');
}

function onSeeLogs() {
  if (!selectedId) return;
  openLogsModal(selectedId);
}

function init() {
  // Ensure Edit modal is closed on load (only opens when user clicks Edit)
  closeEditModal();
  refreshList().catch(() => {});
  if ($('back')) $('back').addEventListener('click', backToList);
  if ($('run-one')) $('run-one').addEventListener('click', onRunOne);
  if ($('run-all')) $('run-all').addEventListener('click', onRunAll);
  if ($('see-logs')) $('see-logs').addEventListener('click', onSeeLogs);
  if ($('logs-modal-close')) $('logs-modal-close').addEventListener('click', closeLogsModal);
  const logsBackdrop = document.querySelector('#logs-modal .modal-backdrop');
  if (logsBackdrop) logsBackdrop.addEventListener('click', closeLogsModal);
  if ($('edit-dataset')) $('edit-dataset').addEventListener('click', openEditModal);
  if ($('edit-modal-close')) $('edit-modal-close').addEventListener('click', closeEditModal);
  const backdrop = document.querySelector('#edit-modal .modal-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeEditModal);
  if ($('edit-back')) $('edit-back').addEventListener('click', onEditBack);
  if ($('edit-save')) $('edit-save').addEventListener('click', onEditSave);
  const statusBtns = $('filter-status-btns');
  if (statusBtns) {
    statusBtns.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedStatus = btn.getAttribute('data-status') || '';
        setActiveFilterBtn(statusBtns, 'data-status', selectedStatus);
        renderList();
      });
    });
  }
}

init();
