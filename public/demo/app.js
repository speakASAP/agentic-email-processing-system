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

function init() {
  // Ensure Edit modal is closed on load (only opens when user clicks Edit)
  closeEditModal();
  refreshList().catch(() => {});
  if ($('back')) $('back').addEventListener('click', backToList);
  if ($('run-one')) $('run-one').addEventListener('click', onRunOne);
  if ($('run-all')) $('run-all').addEventListener('click', onRunAll);
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
