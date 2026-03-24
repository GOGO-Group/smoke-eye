// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let role = null;
let connected = false;
let msgCounter = 0;
let settings = { hotkeys: {}, webpages: [] };
let stickyNotes = [];       // { id, title, content, html }
let uploadedFiles = [];     // [ { path, name, type }, ... ]
let currentStickyIdx = 0;
let shownStickyId = null;   // id of sticky currently shown to interviewer

const FILE_TYPE_LABELS = {
  cv: 'CV', 'job-description': 'JD', 'support-material': 'Material', other: 'Other'
};

function showView(id) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === id));
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Only allow safe inline formatting tags from the rich editor / peer edits
function sanitizeHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const allowed = new Set(['B', 'STRONG', 'MARK', 'BR']);
  (function walk(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) {
        if (!allowed.has(child.tagName)) {
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
        } else {
          for (const a of [...child.attributes]) child.removeAttribute(a.name);
          walk(child);
        }
      }
    }
  })(tmp);
  return tmp.innerHTML;
}

function appendMsg(logEl, { id, from, html, text }, withDelete) {
  const div = document.createElement('div');
  div.className = 'msg ' + (from === role ? 'me' : 'them');
  div.dataset.id = id;

  const content = document.createElement('span');
  content.className = 'msg-content';
  content.innerHTML = html ? sanitizeHtml(html) : escapeHtml(text);
  div.appendChild(content);

  if (withDelete) {
    const del = document.createElement('button');
    del.className = 'msg-del';
    del.textContent = '×';
    del.title = 'Delete message';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      div.remove();
      window.api.sendMessage({ type: 'delete', id });
    });
    div.appendChild(del);
  }

  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

// ========================================================
// Role select — Tab switching
// ========================================================
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const pane = document.getElementById(tab.dataset.tab);
    if (pane) pane.classList.add('active');
  });
});

// ========================================================
// Role select — File uploads (single input + list)
// ========================================================
function renderFileList() {
  const ul = $('#file-list');
  ul.innerHTML = '';
  uploadedFiles.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = 'flex items-center gap-2 px-2 py-1.5 bg-zinc-800 rounded text-xs';
    const badge = document.createElement('span');
    badge.className = 'px-1.5 py-0.5 bg-blue-900 rounded text-[10px] uppercase shrink-0';
    badge.textContent = FILE_TYPE_LABELS[f.type] || f.type;
    const name = document.createElement('span');
    name.className = 'flex-1 truncate';
    name.textContent = f.name;
    name.title = f.path;
    const del = document.createElement('button');
    del.className = 'w-5 h-5 bg-red-900 hover:bg-red-800 rounded text-white shrink-0';
    del.textContent = '×';
    del.addEventListener('click', () => {
      uploadedFiles.splice(i, 1);
      renderFileList();
    });
    li.appendChild(badge);
    li.appendChild(name);
    li.appendChild(del);
    ul.appendChild(li);
  });
}

$('#file-add-btn').addEventListener('click', async () => {
  const paths = await window.api.openFileDialog();
  if (paths && paths.length) {
    const type = $('#file-type').value;
    uploadedFiles.push(...paths.map(p => ({
      path: p, name: p.split(/[/\\]/).pop(), type
    })));
    renderFileList();
  }
});

// ========================================================
// Role select — Sticky notes management
// ========================================================
let stickyIdCounter = 0;

function renderStickyList() {
  const ul = $('#sticky-list');
  ul.innerHTML = '';
  stickyNotes.forEach((note, i) => {
    const li = document.createElement('li');
    li.className = 'flex items-start gap-2 px-2 py-1.5 bg-zinc-800 rounded border-l-2 border-amber-500 text-xs';
    const info = document.createElement('div');
    info.className = 'flex-1 overflow-hidden';
    const strong = document.createElement('strong');
    strong.className = 'block';
    strong.textContent = note.title;
    const span = document.createElement('span');
    span.className = 'text-zinc-400 block truncate';
    span.textContent = note.content;
    info.appendChild(strong);
    info.appendChild(span);
    const del = document.createElement('button');
    del.className = 'w-5 h-5 bg-red-900 hover:bg-red-800 rounded text-white shrink-0';
    del.textContent = '×';
    del.addEventListener('click', () => {
      stickyNotes.splice(i, 1);
      renderStickyList();
    });
    li.appendChild(info);
    li.appendChild(del);
    ul.appendChild(li);
  });
}

function syncStickyList() {
  if (connected) window.api.sendMessage({ type: 'sticky-list', notes: stickyNotes });
}

$('#sticky-add-btn').addEventListener('click', () => {
  const title = $('#sticky-title').value.trim();
  const content = $('#sticky-content').value.trim();
  if (!title && !content) return;
  stickyNotes.push({ id: `sticky-${++stickyIdCounter}`, title: title || 'Note', content, html: escapeHtml(content) });
  $('#sticky-title').value = '';
  $('#sticky-content').value = '';
  renderStickyList();
});
$('#sticky-title').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('#sticky-content').focus(); }
});
$('#sticky-content').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    $('#sticky-add-btn').click();
  }
});

// ========================================================
// Role select — Start buttons
// ========================================================
$('#btn-start-interviewer').addEventListener('click', async () => {
  role = 'interviewer';
  const port = parseInt($('#role-port').value, 10) || 5000;
  showView('view-interviewer');
  $('#iv-grid').dataset.focus = 'caption';
  populateWebList();
  try {
    await window.api.startServer(port);
    $('#iv-status .status-text').textContent = `Listening on ${port} — waiting…`;
  } catch (e) {
    $('#iv-status .status-text').textContent = 'Server error: ' + e;
  }
});

// Support tab — connect
let spConnected = false;
$('#btn-sp-connect').addEventListener('click', async () => {
  if (!spConnected) {
    const host = $('#role-sp-ip').value.trim();
    const port = parseInt($('#role-sp-port').value, 10);
    if (!host || !port) return;
    try {
      role = 'support';
      await window.api.connect(host, port);
      spConnected = true;
      $('#btn-sp-connect').textContent = 'Disconnect';
      $('#btn-sp-connect').classList.remove('bg-green-600', 'hover:bg-green-700');
      $('#btn-sp-connect').classList.add('bg-red-600', 'hover:bg-red-700');
      $('#role-sp-status').textContent = 'Connected';
      $('#btn-start-support').disabled = false;
    } catch (e) {
      $('#role-sp-status').textContent = 'Error: ' + e;
    }
  } else {
    await window.api.disconnect();
    spConnected = false;
    $('#btn-sp-connect').textContent = 'Connect';
    $('#btn-sp-connect').classList.remove('bg-red-600', 'hover:bg-red-700');
    $('#btn-sp-connect').classList.add('bg-green-600', 'hover:bg-green-700');
    $('#role-sp-status').textContent = 'Disconnected';
    $('#btn-start-support').disabled = true;
  }
  // Auto-start caption capture
  startCaption();
});

$('#btn-start-support').addEventListener('click', () => {
  role = 'support';
  showView('view-support');
});

$('#btn-settings').addEventListener('click', () => {
  renderSettings();
  showView('view-settings');
});

$$('.back-btn').forEach(b =>
  b.addEventListener('click', () => showView(b.dataset.target))
);

// ========================================================
// Interviewer: panel focus
// ========================================================
function setIvFocus(panel) {
  $('#iv-grid').dataset.focus = panel;
  if (panel === 'chat') setTimeout(() => $('#iv-chat-input').focus(), 0);
}

$$('#iv-grid .panel-head').forEach(head => {
  head.addEventListener('click', () => setIvFocus(head.dataset.panel));
});

// Re-focus input whenever user clicks anywhere in the chat panel
$('#iv-grid .panel[data-panel="chat"]').addEventListener('mousedown', (e) => {
  if ($('#iv-grid').dataset.focus !== 'chat') return;
  if (e.target.closest('button')) return;
  setTimeout(() => $('#iv-chat-input').focus(), 0);
});

// ========================================================
// Interviewer: sticky button + navigation
// ========================================================
function showStickyAt(idx) {
  if (stickyNotes.length === 0) return;
  currentStickyIdx = ((idx % stickyNotes.length) + stickyNotes.length) % stickyNotes.length;
  window.api.showSticky(stickyNotes[currentStickyIdx]);
}

$('#iv-sticky-btn').addEventListener('click', () => showStickyAt(currentStickyIdx));

// ========================================================
// Interviewer: screen capture
// ========================================================
async function doCapture() {
  const res = await window.api.captureArea();
  if (res && res.ok) showToast('Screenshot copied to clipboard', res.dataURL);
}
$('#iv-capture-btn').addEventListener('click', doCapture);

// ========================================================
// Interviewer: toast
// ========================================================
let toastTimer = null;
function showToast(text, html) {
  const toast = $('#iv-toast');
  const body = $('#iv-toast-body');
  if (html && html.startsWith('data:image')) {
    body.innerHTML = `<img src="${html}" class="max-w-full rounded" />`;
  } else {
    body.innerHTML = html ? sanitizeHtml(html) : escapeHtml(text);
  }
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 5000);
}
$('#iv-toast').addEventListener('click', () => {
  $('#iv-toast').classList.add('hidden');
  clearTimeout(toastTimer);
  setIvFocus('chat');
});

// ========================================================
// Interviewer: web viewer
// ========================================================
function populateWebList() {
  const sel = $('#web-list');
  sel.innerHTML = '<option value="">-- pages --</option>';
  for (const url of settings.webpages) {
    const opt = document.createElement('option');
    opt.value = url;
    opt.textContent = url;
    sel.appendChild(opt);
  }
}
$('#web-list').addEventListener('change', (e) => {
  if (e.target.value) {
    $('#web-url').value = e.target.value;
    $('#webview').src = e.target.value;
  }
});
$('#web-go').addEventListener('click', () => {
  const url = $('#web-url').value.trim();
  if (url) $('#webview').src = url;
});
$('#web-url').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#web-go').click();
});

// ========================================================
// Interviewer: chat
// ========================================================
function ivSend(text) {
  text = (text ?? $('#iv-chat-input').value).trim();
  if (!text) return;
  const id = `${role}-${Date.now()}-${msgCounter++}`;
  const payload = { type: 'msg', id, from: role, text, html: escapeHtml(text) };
  appendMsg($('#iv-chat-log'), payload, false);
  window.api.sendMessage(payload);
  $('#iv-chat-input').value = '';
}
$('#iv-chat-send').addEventListener('click', () => ivSend());
$('#iv-chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') ivSend();
});

// ========================================================
// Support: chat (rich input)
// ========================================================
function spSend() {
  const input = $('#sp-chat-input');
  const html = sanitizeHtml(input.innerHTML).trim();
  const text = input.textContent.trim();
  if (!text) return;
  const id = `${role}-${Date.now()}-${msgCounter++}`;
  const payload = { type: 'msg', id, from: role, text, html };
  appendMsg($('#sp-chat-log'), payload, true);
  window.api.sendMessage(payload);
  input.innerHTML = '';
}
$('#sp-chat-send').addEventListener('click', spSend);
$('#sp-chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); spSend(); }
});

// ========================================================
// Support: formatting (toggle)
// ========================================================
function toggleWrap(tag) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);

  let container = range.commonAncestorContainer;
  if (container.nodeType === 3) container = container.parentElement;

  const inInput = container.closest('#sp-chat-input');
  const msgEl = container.closest('#sp-chat-log .msg');
  if (!inInput && !msgEl) return;

  let existing = container.closest(tag);
  const boundary = inInput || msgEl.querySelector('.msg-content');
  if (existing && !boundary.contains(existing)) existing = null;

  if (existing) {
    while (existing.firstChild)
      existing.parentNode.insertBefore(existing.firstChild, existing);
    existing.remove();
  } else {
    const wrapper = document.createElement(tag);
    try {
      range.surroundContents(wrapper);
    } catch {
      wrapper.appendChild(range.extractContents());
      range.insertNode(wrapper);
    }
  }
  sel.removeAllRanges();

  if (msgEl) syncEdit(msgEl);
}

function clearFormat() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let node = sel.getRangeAt(0).commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentElement;

  const inInput = node.closest('#sp-chat-input');
  const msgEl = node.closest('#sp-chat-log .msg');

  if (inInput) {
    inInput.textContent = inInput.textContent;
  } else if (msgEl) {
    const c = msgEl.querySelector('.msg-content');
    c.textContent = c.textContent;
    syncEdit(msgEl);
  }
  sel.removeAllRanges();
}

function syncEdit(msgEl) {
  window.api.sendMessage({
    type: 'edit',
    id: msgEl.dataset.id,
    html: msgEl.querySelector('.msg-content').innerHTML
  });
}

['#fmt-bold', '#fmt-hl', '#fmt-clear'].forEach(id =>
  $(id).addEventListener('mousedown', e => e.preventDefault())
);
$('#fmt-bold').addEventListener('click', () => toggleWrap('b'));
$('#fmt-hl').addEventListener('click', () => toggleWrap('mark'));
$('#fmt-clear').addEventListener('click', clearFormat);

// ========================================================
// Support: clear history
// ========================================================
$('#chat-clear').addEventListener('click', () => {
  if (!confirm('Clear all chat history?')) return;
  $('#sp-chat-log').innerHTML = '';
  window.api.sendMessage({ type: 'clear' });
});

// ========================================================
// Support: sticky notes list + modal
// ========================================================
let receivedStickies = [];
let modalNote = null;
let spStickyIdCounter = 0;

function renderSupportStickies() {
  const ul = $('#sp-sticky-list');
  ul.innerHTML = '';
  if (receivedStickies.length === 0) {
    const li = document.createElement('li');
    li.className = 'sp-sticky-empty text-xs text-zinc-500 p-2';
    li.textContent = 'No sticky notes yet';
    ul.appendChild(li);
    return;
  }
  receivedStickies.forEach(note => {
    const li = document.createElement('li');
    li.className = 'relative px-2 py-1.5 bg-zinc-950 rounded border-l-2 border-amber-500 cursor-pointer hover:bg-zinc-800 text-xs transition group';
    const strong = document.createElement('strong');
    strong.className = 'block pr-5';
    strong.textContent = note.title;
    const span = document.createElement('span');
    span.className = 'text-zinc-400 block truncate';
    span.textContent = note.content;
    const del = document.createElement('button');
    del.className = 'absolute top-1 right-1 w-4 h-4 bg-red-900 hover:bg-red-800 rounded text-white text-[10px] leading-none opacity-0 group-hover:opacity-100 transition';
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSticky(note.id);
    });
    li.appendChild(strong);
    li.appendChild(span);
    li.appendChild(del);
    li.addEventListener('click', () => openStickyModal(note));
    ul.appendChild(li);
  });
}

function updateModalShowBtn() {
  const btn = $('#sp-modal-show');
  const isShown = modalNote && shownStickyId === modalNote.id;
  btn.textContent = isShown ? 'Hide from Interviewer' : 'Show to Interviewer';
  btn.classList.toggle('bg-amber-500', !isShown);
  btn.classList.toggle('hover:bg-amber-600', !isShown);
  btn.classList.toggle('text-black', !isShown);
  btn.classList.toggle('bg-zinc-600', isShown);
  btn.classList.toggle('hover:bg-zinc-500', isShown);
  btn.classList.toggle('text-white', isShown);
}

function openStickyModal(note) {
  modalNote = note;
  $('#sp-modal-title').value = note.title;
  $('#sp-modal-body').innerHTML = note.html ? sanitizeHtml(note.html) : escapeHtml(note.content || '');
  $('#sp-modal-delete').classList.toggle('invisible', !note.id);
  updateModalShowBtn();
  $('#sp-sticky-modal').classList.remove('hidden');
}

function closeStickyModal() {
  $('#sp-sticky-modal').classList.add('hidden');
  modalNote = null;
}

function saveModalNote() {
  const title = $('#sp-modal-title').value.trim() || 'Note';
  const body = $('#sp-modal-body');
  const html = sanitizeHtml(body.innerHTML);
  const content = body.textContent;
  if (modalNote && modalNote.id) {
    modalNote.title = title;
    modalNote.content = content;
    modalNote.html = html;
    window.api.sendMessage({ type: 'sticky-update', note: modalNote });
    renderSupportStickies();
  } else {
    const note = { id: `sp-sticky-${Date.now()}-${++spStickyIdCounter}`, title, content, html };
    receivedStickies.push(note);
    window.api.sendMessage({ type: 'sticky-add', note });
    renderSupportStickies();
    modalNote = note;
    $('#sp-modal-delete').classList.remove('invisible');
  }
  updateModalShowBtn();
}

function deleteSticky(id) {
  const idx = receivedStickies.findIndex(n => n.id === id);
  if (idx >= 0) receivedStickies.splice(idx, 1);
  if (shownStickyId === id) shownStickyId = null;
  window.api.sendMessage({ type: 'sticky-delete', id });
  renderSupportStickies();
}

$('#sp-sticky-add').addEventListener('click', () => {
  openStickyModal({ id: null, title: '', content: '', html: '' });
});

$('#sp-modal-close').addEventListener('click', closeStickyModal);
$('#sp-modal-close2').addEventListener('click', closeStickyModal);
$('#sp-modal-save').addEventListener('click', saveModalNote);

$('#sp-modal-delete').addEventListener('click', () => {
  if (!modalNote || !modalNote.id) return;
  if (!confirm('Delete this sticky note?')) return;
  deleteSticky(modalNote.id);
  closeStickyModal();
});

$('#sp-modal-show').addEventListener('click', () => {
  if (!modalNote) return;
  if (!modalNote.id) saveModalNote();
  if (shownStickyId === modalNote.id) {
    window.api.sendMessage({ type: 'hide-sticky' });
    shownStickyId = null;
  } else {
    window.api.sendMessage({ type: 'show-sticky', note: modalNote });
    shownStickyId = modalNote.id;
  }
  updateModalShowBtn();
});

// Modal formatting
function modalToggleWrap(tag) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  let container = range.commonAncestorContainer;
  if (container.nodeType === 3) container = container.parentElement;
  const body = container.closest('#sp-modal-body');
  if (!body) return;
  let existing = container.closest(tag);
  if (existing && !body.contains(existing)) existing = null;
  if (existing) {
    while (existing.firstChild) existing.parentNode.insertBefore(existing.firstChild, existing);
    existing.remove();
  } else {
    const w = document.createElement(tag);
    try { range.surroundContents(w); }
    catch { w.appendChild(range.extractContents()); range.insertNode(w); }
  }
  sel.removeAllRanges();
}
['#sp-modal-bold', '#sp-modal-hl', '#sp-modal-fmt-clear'].forEach(id =>
  $(id).addEventListener('mousedown', e => e.preventDefault())
);
$('#sp-modal-bold').addEventListener('click', () => modalToggleWrap('b'));
$('#sp-modal-hl').addEventListener('click', () => modalToggleWrap('mark'));
$('#sp-modal-fmt-clear').addEventListener('click', () => {
  const b = $('#sp-modal-body');
  b.textContent = b.textContent;
});

// ========================================================
// Support: interviewer file list + download
// ========================================================
let receivedFiles = [];

function renderSupportFiles() {
  const ul = $('#sp-file-list');
  ul.innerHTML = '';
  if (receivedFiles.length === 0) {
    ul.innerHTML = '<li class="text-xs text-zinc-500 p-2">No files yet</li>';
    return;
  }
  receivedFiles.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = 'flex items-center gap-1.5 px-2 py-1.5 bg-zinc-950 rounded text-xs cursor-pointer hover:bg-zinc-800 transition';
    li.title = 'Click to download';
    const badge = document.createElement('span');
    badge.className = 'px-1 py-0.5 bg-blue-900 rounded text-[9px] uppercase shrink-0';
    badge.textContent = FILE_TYPE_LABELS[f.type] || f.type;
    const name = document.createElement('span');
    name.className = 'flex-1 truncate';
    name.textContent = f.name;
    li.appendChild(badge);
    li.appendChild(name);
    li.addEventListener('click', () => {
      li.classList.add('opacity-50');
      window.api.sendMessage({ type: 'request-file', index: i });
    });
    ul.appendChild(li);
  });
}

// ========================================================
// Incoming messages
// ========================================================
window.api.onChatMessage(async (msg) => {
  const log = role === 'interviewer' ? $('#iv-chat-log') : $('#sp-chat-log');
  const withDel = role === 'support';

  if (msg.type === 'msg') {
    appendMsg(log, msg, withDel);
    if (role === 'interviewer') {
      const badge = $('#iv-badge');
      badge.classList.remove('hidden');
      clearTimeout(badge._timer);
      badge._timer = setTimeout(() => badge.classList.add('hidden'), 3000);
      if ($('#iv-grid').dataset.focus !== 'chat') {
        showToast(msg.text, msg.html);
      }
    }
  } else if (msg.type === 'edit') {
    const el = log.querySelector(`.msg[data-id="${msg.id}"] .msg-content`);
    if (el) el.innerHTML = sanitizeHtml(msg.html);
  } else if (msg.type === 'delete') {
    const el = log.querySelector(`.msg[data-id="${msg.id}"]`);
    if (el) el.remove();
  } else if (msg.type === 'clear') {
    log.innerHTML = '';
  } else if (msg.type === 'sticky-list') {
    if (role === 'support') {
      receivedStickies = msg.notes || [];
      renderSupportStickies();
    }
  } else if (msg.type === 'show-sticky') {
    if (role === 'interviewer') {
      const idx = stickyNotes.findIndex(n => n.id === msg.note.id);
      if (idx >= 0) currentStickyIdx = idx;
      window.api.showSticky(msg.note);
    }
  } else if (msg.type === 'hide-sticky') {
    if (role === 'interviewer') window.api.hideSticky();
  } else if (msg.type === 'sticky-add') {
    if (role === 'interviewer') {
      stickyNotes.push(msg.note);
      renderStickyList();
    }
  } else if (msg.type === 'sticky-update') {
    if (role === 'interviewer') {
      const idx = stickyNotes.findIndex(n => n.id === msg.note.id);
      if (idx >= 0) stickyNotes[idx] = msg.note;
      else stickyNotes.push(msg.note);
      renderStickyList();
    }
  } else if (msg.type === 'sticky-delete') {
    if (role === 'interviewer') {
      const idx = stickyNotes.findIndex(n => n.id === msg.id);
      if (idx >= 0) stickyNotes.splice(idx, 1);
      renderStickyList();
    }
  } else if (msg.type === 'file-list') {
    if (role === 'support') {
      receivedFiles = msg.files || [];
      renderSupportFiles();
    }
  } else if (msg.type === 'request-file') {
    if (role === 'interviewer') {
      const f = uploadedFiles[msg.index];
      if (!f) return;
      const res = await window.api.readFile(f.path);
      if (res.ok) {
        window.api.sendMessage({ type: 'file-data', name: f.name, data: res.data });
      }
    }
  } else if (msg.type === 'file-data') {
    if (role === 'support') {
      await window.api.saveFile({ name: msg.name, data: msg.data });
      renderSupportFiles();
    }
  }
});

window.api.onPeerStatus((s) => {
  connected = !!s.connected;
  if (role === 'interviewer') {
    const el = $('#iv-status');
    const port = $('#role-port').value || '5000';
    $('#iv-status .status-text').textContent = connected
      ? 'Support connected'
      : `Listening on ${port} — waiting…`;
    el.classList.toggle('on', connected);
    el.classList.toggle('off', !connected);

    if (connected) {
      if (stickyNotes.length > 0)
        window.api.sendMessage({ type: 'sticky-list', notes: stickyNotes });
      if (uploadedFiles.length > 0)
        window.api.sendMessage({
          type: 'file-list',
          files: uploadedFiles.map(f => ({ name: f.name, type: f.type }))
        });
    }
  } else if (role === 'support') {
    const el = $('#sp-status');
    $('#sp-status .status-text').textContent = connected ? 'Connected' : 'Disconnected';
    el.classList.toggle('on', connected);
    el.classList.toggle('off', !connected);
  }
});

// ========================================================
// Hotkey actions
// ========================================================
window.api.onHotkeyAction((a) => {
  if (a.action === 'focusPanel') {
    if (role === 'interviewer') setIvFocus(a.panel);
    return;
  }
  if (a.action === 'toggleSticky') {
    if (role === 'interviewer' && stickyNotes.length > 0) showStickyAt(currentStickyIdx);
    return;
  }
  if (a.action === 'navSticky') {
    if (role === 'interviewer') showStickyAt(currentStickyIdx + a.dir);
    return;
  }
  if (a.action === 'captureArea') {
    if (role === 'interviewer') doCapture();
    return;
  }
  if (a.action !== 'helpRequest') return;
  if (role === 'interviewer') {
    ivSend('🆘 Help request');
  } else if (role === 'support') {
    const id = `${role}-${Date.now()}-${msgCounter++}`;
    const payload = { type: 'msg', id, from: role, text: 'Help request', html: '<b>🆘 Help request</b>' };
    appendMsg($('#sp-chat-log'), payload, true);
    window.api.sendMessage(payload);
  }
});

// ========================================================
// Settings page
// ========================================================
async function loadSettings() {
  settings = await window.api.getSettings();
}

function renderSettings() {
  $$('.hk').forEach(inp => {
    inp.value = settings.hotkeys[inp.dataset.hk] || '';
  });
  renderWebpages();
}

function renderWebpages() {
  const ul = $('#wp-list');
  ul.innerHTML = '';
  settings.webpages.forEach((url, i) => {
    const li = document.createElement('li');
    li.className = 'flex items-center gap-2 px-2 py-1.5 bg-zinc-950 rounded text-xs';
    const span = document.createElement('span');
    span.className = 'flex-1 truncate';
    span.textContent = url;
    const del = document.createElement('button');
    del.className = 'w-5 h-5 bg-red-900 hover:bg-red-800 rounded text-white';
    del.textContent = '×';
    del.addEventListener('click', () => {
      settings.webpages.splice(i, 1);
      renderWebpages();
    });
    li.appendChild(span);
    li.appendChild(del);
    ul.appendChild(li);
  });
}

// hotkey capture
$$('.hk').forEach(inp => {
  inp.addEventListener('focus', () => { inp.classList.add('recording'); window.api.suspendHotkeys(); });
  inp.addEventListener('blur', () => { inp.classList.remove('recording'); window.api.resumeHotkeys(); });
  inp.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (e.key === 'Escape') { inp.blur(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      inp.value = '';
      settings.hotkeys[inp.dataset.hk] = '';
      return;
    }
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    const k = normalizeKey(e.key);
    if (!k || ['Control','Alt','Shift','Meta'].includes(e.key)) return;
    parts.push(k);
    const accel = parts.join('+');
    inp.value = accel;
    settings.hotkeys[inp.dataset.hk] = accel;
  });
});

function normalizeKey(k) {
  const map = {
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    ' ': 'Space', Escape: 'Esc', '+': 'Plus'
  };
  if (map[k]) return map[k];
  if (k.length === 1) return k.toUpperCase();
  return k;
}

$('#wp-add-btn').addEventListener('click', () => {
  const v = $('#wp-input').value.trim();
  if (!v) return;
  settings.webpages.push(v);
  $('#wp-input').value = '';
  renderWebpages();
});
$('#wp-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#wp-add-btn').click();
});

$('#settings-save').addEventListener('click', async () => {
  settings = await window.api.setSettings(settings);
  populateWebList();
  alert('Settings saved');
});

// ---------- init ----------
loadSettings().then(populateWebList);
