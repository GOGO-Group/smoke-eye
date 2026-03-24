// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let role = null;
let connected = false;
let msgCounter = 0;
let settings = { hotkeys: {}, webpages: [] };
let stickyNotes = [];       // { id, title, content }  — interviewer's own notes
let uploadedFiles = [];     // { path, name, fileType }
let currentStickyIdx = 0;
let stickyShowing = false;  // track if sticky is currently shown

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
// Role select — File uploads with type label
// ========================================================
function renderFileList() {
  const ul = $('#file-list');
  ul.innerHTML = '';
  uploadedFiles.forEach((f, i) => {
    const li = document.createElement('li');
    li.className = 'flex items-center gap-2 px-2 py-1.5 bg-zinc-800 rounded text-xs';

    const typeBadge = document.createElement('span');
    typeBadge.className = 'shrink-0 px-1.5 py-0.5 bg-zinc-700 rounded text-zinc-300 font-medium';
    typeBadge.textContent = f.fileType || 'Other';

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

    li.appendChild(typeBadge);
    li.appendChild(name);
    li.appendChild(del);
    ul.appendChild(li);
  });
}

$('#file-add-btn').addEventListener('click', async () => {
  const paths = await window.api.openFileDialog();
  if (paths && paths.length) {
    const fileType = $('#file-type-select').value;
    paths.forEach(p => {
      uploadedFiles.push({ path: p, name: p.split(/[/\\]/).pop(), fileType });
    });
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

$('#sticky-add-btn').addEventListener('click', () => {
  const title = $('#sticky-title').value.trim();
  const content = $('#sticky-content').value.trim();
  if (!title && !content) return;
  stickyNotes.push({ id: `sticky-${++stickyIdCounter}`, title: title || 'Note', content });
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
  updateStickyNavButtons();
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
});

$('#btn-start-support').addEventListener('click', () => {
  role = 'support';
  showView('view-support');
  // Focus message input immediately
  setTimeout(() => $('#sp-chat-input').focus(), 100);
});

$('#btn-settings').addEventListener('click', () => {
  renderSettings();
  showView('view-settings');
});

$$('.back-btn').forEach(b =>
  b.addEventListener('click', () => showView(b.dataset.target))
);

// ========================================================
// Interviewer: panel focus + auto-focus chat input
// ========================================================
$$('#iv-grid .panel-head').forEach(head => {
  head.addEventListener('click', () => {
    const panel = head.dataset.panel;
    $('#iv-grid').dataset.focus = panel;
    if (panel === 'chat') {
      setTimeout(() => $('#iv-chat-input').focus(), 50);
    }
  });
});

// ========================================================
// Interviewer: sticky navigation buttons
// ========================================================
function updateStickyNavButtons() {
  const hasSt = stickyNotes.length > 1;
  $('#iv-sticky-prev').style.display = hasSt ? '' : 'none';
  $('#iv-sticky-next').style.display = hasSt ? '' : 'none';
}

function showStickyAtIndex(idx) {
  if (stickyNotes.length === 0) return;
  currentStickyIdx = ((idx % stickyNotes.length) + stickyNotes.length) % stickyNotes.length;
  const note = stickyNotes[currentStickyIdx];
  window.api.showSticky(note);
  stickyShowing = true;
  updateShowHideBtn();
}

function updateShowHideBtn() {
  // This is for the interviewer's own sticky toggle button
  const btn = $('#iv-sticky-btn');
  if (stickyShowing) {
    btn.title = 'Hide sticky note';
    btn.style.opacity = '1';
  } else {
    btn.title = 'Show sticky note';
    btn.style.opacity = '0.6';
  }
}

$('#iv-sticky-btn').addEventListener('click', () => {
  if (stickyNotes.length === 0) return;
  if (stickyShowing) {
    window.api.hideSticky();
    stickyShowing = false;
  } else {
    showStickyAtIndex(currentStickyIdx);
  }
  updateShowHideBtn();
});

$('#iv-sticky-prev').addEventListener('click', () => {
  showStickyAtIndex(currentStickyIdx - 1);
});
$('#iv-sticky-next').addEventListener('click', () => {
  showStickyAtIndex(currentStickyIdx + 1);
});

// Keyboard navigation for stickies (Alt+[ and Alt+])
document.addEventListener('keydown', (e) => {
  if (role !== 'interviewer') return;
  if (e.altKey && e.key === '[') {
    e.preventDefault();
    showStickyAtIndex(currentStickyIdx - 1);
  } else if (e.altKey && e.key === ']') {
    e.preventDefault();
    showStickyAtIndex(currentStickyIdx + 1);
  }
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
// Interviewer: screen capture gadget
// ========================================================
$('#iv-capture-btn').addEventListener('click', () => startCapture());

function startCapture() {
  const overlay = $('#capture-overlay');
  const sel = $('#capture-selection');
  overlay.classList.remove('hidden');

  let startX, startY, dragging = false;

  function onMouseDown(e) {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    sel.classList.remove('hidden');
    sel.style.left = startX + 'px';
    sel.style.top = startY + 'px';
    sel.style.width = '0';
    sel.style.height = '0';
  }

  function onMouseMove(e) {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    sel.style.left = x + 'px';
    sel.style.top = y + 'px';
    sel.style.width = w + 'px';
    sel.style.height = h + 'px';
  }

  async function onMouseUp(e) {
    if (!dragging) return;
    dragging = false;

    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    // Clean up
    overlay.classList.add('hidden');
    sel.classList.add('hidden');
    overlay.removeEventListener('mousedown', onMouseDown);
    overlay.removeEventListener('mousemove', onMouseMove);
    overlay.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keydown', onEsc);

    if (w < 5 || h < 5) return;

    // Capture the window content
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: 'screen' },
        audio: false
      });
      const video = document.createElement('video');
      video.srcObject = stream;
      await new Promise(r => { video.onloadedmetadata = r; });
      video.play();
      await new Promise(r => requestAnimationFrame(r));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      // Scale factor between logical px and video resolution
      const scaleX = video.videoWidth / window.screen.width;
      const scaleY = video.videoHeight / window.screen.height;

      // Get window position offset within the screen
      const winX = window.screenX || window.screenLeft || 0;
      const winY = window.screenY || window.screenTop || 0;

      ctx.drawImage(video,
        (winX + x) * scaleX, (winY + y) * scaleY,
        w * scaleX, h * scaleY,
        0, 0, w, h
      );

      stream.getTracks().forEach(t => t.stop());

      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          showCaptureConfirm();
        } catch (err) {
          console.error('Clipboard write failed', err);
        }
      }, 'image/png');
    } catch (err) {
      // User cancelled getDisplayMedia or other error
      console.error('Capture error', err);
    }
  }

  function onEsc(e) {
    if (e.key === 'Escape') {
      dragging = false;
      overlay.classList.add('hidden');
      sel.classList.add('hidden');
      overlay.removeEventListener('mousedown', onMouseDown);
      overlay.removeEventListener('mousemove', onMouseMove);
      overlay.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onEsc);
    }
  }

  overlay.addEventListener('mousedown', onMouseDown);
  overlay.addEventListener('mousemove', onMouseMove);
  overlay.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onEsc);
}

function showCaptureConfirm() {
  // Brief toast notification
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] bg-green-700 text-white text-sm px-4 py-2 rounded-lg shadow-xl pointer-events-none';
  toast.textContent = 'Screenshot copied to clipboard';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ========================================================
// Support: chat (rich input) + auto-focus when pane active
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

// Auto-focus support chat input when view becomes active
// (MutationObserver on view-support class list)
(function() {
  const supportView = $('#view-support');
  const observer = new MutationObserver(() => {
    if (supportView.classList.contains('active')) {
      setTimeout(() => $('#sp-chat-input').focus(), 50);
    }
  });
  observer.observe(supportView, { attributes: true, attributeFilter: ['class'] });
})();

// ========================================================
// Support: formatting (toggle)
// ========================================================
function toggleWrap(tag, scope) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);

  let container = range.commonAncestorContainer;
  if (container.nodeType === 3) container = container.parentElement;

  // Allow in sp-chat-input, sp-chat-log .msg, or modal body
  const inInput = container.closest('#sp-chat-input');
  const inModal = container.closest('#sp-modal-body');
  const msgEl = container.closest('#sp-chat-log .msg');
  if (!inInput && !msgEl && !inModal) return;

  let existing = container.closest(tag);
  const boundary = inInput || inModal || (msgEl && msgEl.querySelector('.msg-content'));
  if (existing && boundary && !boundary.contains(existing)) existing = null;

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

function clearFormat(scope) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let node = sel.getRangeAt(0).commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentElement;

  const inInput = node.closest('#sp-chat-input');
  const inModal = node.closest('#sp-modal-body');
  const msgEl = node.closest('#sp-chat-log .msg');

  if (inInput) {
    inInput.textContent = inInput.textContent;
  } else if (inModal) {
    inModal.textContent = inModal.textContent;
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
$('#fmt-clear').addEventListener('click', () => clearFormat());

// Modal formatting buttons
['#sp-modal-fmt-bold', '#sp-modal-fmt-hl', '#sp-modal-fmt-clear'].forEach(id =>
  $(id).addEventListener('mousedown', e => e.preventDefault())
);
$('#sp-modal-fmt-bold').addEventListener('click', () => toggleWrap('b'));
$('#sp-modal-fmt-hl').addEventListener('click', () => toggleWrap('mark'));
$('#sp-modal-fmt-clear').addEventListener('click', () => clearFormat());

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
let receivedStickies = [];   // from interviewer (read-only title, editable content locally)
let ownStickies = [];        // support-created
let modalNote = null;
let modalNoteSource = null;  // 'received' | 'own'
let modalNoteIdx = -1;
let stickyBeingShown = null; // id of sticky currently shown to interviewer

function allStickies() {
  return [...receivedStickies, ...ownStickies];
}

function renderSupportStickies() {
  const ul = $('#sp-sticky-list');
  ul.innerHTML = '';
  const all = allStickies();
  if (all.length === 0) {
    const li = document.createElement('li');
    li.className = 'sp-sticky-empty text-xs text-zinc-500 p-2';
    li.textContent = 'No sticky notes yet';
    ul.appendChild(li);
    return;
  }
  all.forEach((note, i) => {
    const li = document.createElement('li');
    const isShowing = stickyBeingShown === note.id;
    li.className = 'px-2 py-1.5 bg-zinc-950 rounded border-l-2 cursor-pointer hover:bg-zinc-800 text-xs transition ' +
                   (isShowing ? 'border-green-400' : 'border-amber-500');
    const header = document.createElement('div');
    header.className = 'flex items-center gap-1';
    const strong = document.createElement('strong');
    strong.className = 'block flex-1';
    strong.textContent = note.title;
    if (isShowing) {
      const tag = document.createElement('span');
      tag.className = 'text-green-400 text-xs';
      tag.textContent = '● shown';
      header.appendChild(strong);
      header.appendChild(tag);
    } else {
      header.appendChild(strong);
    }
    const span = document.createElement('span');
    span.className = 'text-zinc-400 block truncate';
    span.textContent = note.content || '';
    li.appendChild(header);
    li.appendChild(span);
    li.addEventListener('click', () => openStickyModal(note, i));
    ul.appendChild(li);
  });
}

function openStickyModal(note, idx) {
  modalNote = note;
  modalNoteIdx = idx;
  modalNoteSource = idx < receivedStickies.length ? 'received' : 'own';

  $('#sp-modal-title-input').value = note.title;
  $('#sp-modal-body').innerHTML = note.content || '';

  const isShowing = stickyBeingShown === note.id;
  updateModalShowBtn(isShowing);

  // Delete only available for own stickies
  $('#sp-modal-delete').style.display = modalNoteSource === 'own' ? '' : 'none';

  $('#sp-sticky-modal').classList.remove('hidden');
  // Focus body for immediate editing
  setTimeout(() => $('#sp-modal-body').focus(), 50);
}

function updateModalShowBtn(showing) {
  const btn = $('#sp-modal-show');
  if (showing) {
    btn.textContent = 'Hide from Interviewer';
    btn.className = 'px-4 py-2 bg-zinc-600 hover:bg-zinc-500 text-white font-semibold rounded text-sm';
  } else {
    btn.textContent = 'Show';
    btn.className = 'px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-semibold rounded text-sm';
  }
}

function saveModalEdits() {
  if (!modalNote) return;
  const newTitle = $('#sp-modal-title-input').value.trim() || modalNote.title;
  const newContent = sanitizeHtml($('#sp-modal-body').innerHTML);
  modalNote.title = newTitle;
  modalNote.content = newContent;

  // Update in the correct array
  if (modalNoteSource === 'received') {
    const idx = receivedStickies.findIndex(n => n.id === modalNote.id);
    if (idx >= 0) receivedStickies[idx] = modalNote;
  } else {
    const idx = ownStickies.findIndex(n => n.id === modalNote.id);
    if (idx >= 0) ownStickies[idx] = modalNote;
  }

  // If currently showing, update the displayed sticky
  if (stickyBeingShown === modalNote.id) {
    window.api.sendMessage({ type: 'show-sticky', note: modalNote });
  }
}

function closeStickyModal() {
  saveModalEdits();
  $('#sp-sticky-modal').classList.add('hidden');
  renderSupportStickies();
  modalNote = null;
  modalNoteIdx = -1;
}

$('#sp-modal-close').addEventListener('click', closeStickyModal);
$('#sp-modal-close2').addEventListener('click', closeStickyModal);

$('#sp-modal-show').addEventListener('click', () => {
  if (!modalNote) return;
  const isShowing = stickyBeingShown === modalNote.id;
  if (isShowing) {
    // Hide it
    window.api.sendMessage({ type: 'hide-sticky' });
    window.api.hideSticky();
    stickyBeingShown = null;
    updateModalShowBtn(false);
  } else {
    // Save edits first
    saveModalEdits();
    // Show to interviewer
    window.api.sendMessage({ type: 'show-sticky', note: modalNote });
    stickyBeingShown = modalNote.id;
    updateModalShowBtn(true);
  }
  renderSupportStickies();
});

$('#sp-modal-delete').addEventListener('click', () => {
  if (!modalNote || modalNoteSource !== 'own') return;
  if (!confirm('Delete this sticky note?')) return;
  const idx = ownStickies.findIndex(n => n.id === modalNote.id);
  if (idx >= 0) ownStickies.splice(idx, 1);
  if (stickyBeingShown === modalNote.id) {
    window.api.hideSticky();
    stickyBeingShown = null;
  }
  $('#sp-sticky-modal').classList.add('hidden');
  modalNote = null;
  renderSupportStickies();
});

// ========================================================
// Support: add new sticky button
// ========================================================
let spStickyIdCounter = 0;

$('#sp-sticky-add-btn').addEventListener('click', () => {
  $('#sp-new-title').value = '';
  $('#sp-new-content').value = '';
  $('#sp-sticky-new-modal').classList.remove('hidden');
  setTimeout(() => $('#sp-new-title').focus(), 50);
});

$('#sp-new-close').addEventListener('click', () => $('#sp-sticky-new-modal').classList.add('hidden'));
$('#sp-new-cancel').addEventListener('click', () => $('#sp-sticky-new-modal').classList.add('hidden'));

$('#sp-new-save').addEventListener('click', () => {
  const title = $('#sp-new-title').value.trim() || 'Note';
  const content = $('#sp-new-content').value.trim();
  ownStickies.push({ id: `sp-sticky-${++spStickyIdCounter}`, title, content });
  $('#sp-sticky-new-modal').classList.add('hidden');
  renderSupportStickies();
});

$('#sp-new-title').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('#sp-new-content').focus(); }
});
$('#sp-new-content').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#sp-new-save').click(); }
});

// ========================================================
// Support: interviewer file list + download
// ========================================================
let interviewerFiles = [];  // { path, name, fileType } sent over network

function renderSupportFileList() {
  const ul = $('#sp-file-list');
  ul.innerHTML = '';
  if (interviewerFiles.length === 0) {
    const li = document.createElement('li');
    li.className = 'sp-file-empty text-xs text-zinc-500 p-2';
    li.textContent = 'No files shared';
    ul.appendChild(li);
    return;
  }
  interviewerFiles.forEach(f => {
    const li = document.createElement('li');
    li.className = 'flex items-center gap-2 px-2 py-1.5 bg-zinc-950 rounded text-xs';

    const badge = document.createElement('span');
    badge.className = 'shrink-0 px-1.5 py-0.5 bg-zinc-700 rounded text-zinc-300 font-medium';
    badge.textContent = f.fileType || 'File';

    const name = document.createElement('span');
    name.className = 'flex-1 truncate';
    name.textContent = f.name;

    const dl = document.createElement('button');
    dl.className = 'shrink-0 px-2 py-0.5 bg-blue-700 hover:bg-blue-600 rounded text-white';
    dl.textContent = '↓';
    dl.title = 'Download';
    dl.addEventListener('click', async () => {
      dl.disabled = true;
      dl.textContent = '…';
      const res = await window.api.readFile(f.path);
      if (res.ok) {
        await window.api.saveFileDialog(res.name, res.data);
      } else {
        alert('Could not read file: ' + (res.error || 'unknown error'));
      }
      dl.disabled = false;
      dl.textContent = '↓';
    });

    li.appendChild(badge);
    li.appendChild(name);
    li.appendChild(dl);
    ul.appendChild(li);
  });
}

// ========================================================
// Incoming messages
// ========================================================
let toastTimer = null;

window.api.onChatMessage((msg) => {
  const log = role === 'interviewer' ? $('#iv-chat-log') : $('#sp-chat-log');
  const withDel = role === 'support';

  if (msg.type === 'msg') {
    appendMsg(log, msg, withDel);

    if (role === 'interviewer') {
      // Badge notification
      const badge = $('#iv-badge');
      badge.classList.remove('hidden');
      clearTimeout(badge._timer);
      badge._timer = setTimeout(() => badge.classList.add('hidden'), 3000);

      // In-app toast if not on chat pane
      const focusedPanel = $('#iv-grid').dataset.focus;
      if (focusedPanel !== 'chat') {
        showMsgToast(msg.text || msg.html || '');
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
      window.api.showSticky(msg.note);
    }
  } else if (msg.type === 'hide-sticky') {
    if (role === 'interviewer') {
      window.api.hideSticky();
    }
  } else if (msg.type === 'file-list') {
    if (role === 'support') {
      interviewerFiles = msg.files || [];
      renderSupportFileList();
    }
  }
});

function showMsgToast(text) {
  const toast = $('#iv-msg-toast');
  const textEl = $('#iv-msg-toast-text');
  // Strip HTML for plain text display
  const tmp = document.createElement('div');
  tmp.innerHTML = text;
  textEl.textContent = tmp.textContent || text;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 5000);
}

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
      if (stickyNotes.length > 0) {
        window.api.sendMessage({ type: 'sticky-list', notes: stickyNotes });
      }
      // Send file list to support
      if (uploadedFiles.length > 0) {
        window.api.sendMessage({ type: 'file-list', files: uploadedFiles });
      }
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
    if (role === 'interviewer') {
      $('#iv-grid').dataset.focus = a.panel;
      if (a.panel === 'chat') {
        setTimeout(() => $('#iv-chat-input').focus(), 50);
      }
    }
    return;
  }
  if (a.action === 'toggleSticky') {
    if (role === 'interviewer' && stickyNotes.length > 0) {
      if (stickyShowing) {
        window.api.hideSticky();
        stickyShowing = false;
      } else {
        showStickyAtIndex(currentStickyIdx);
      }
      updateShowHideBtn();
    }
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
