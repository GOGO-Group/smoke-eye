"use strict";
// Round pie-controller, drawn on a canvas. Mirrors the Python floating dial:
// center hub = pick/target, four quadrants = top(T)/left(safe P)/right(thru C)/
// bottom(more). Win32 work is delegated to the native backend via window.api.

const SIZE = 168,
  C = SIZE / 2,
  R = 64,
  HUBR = 23,
  OFF = 40;
const ACCENT = "#37e3c3"; // aqua glow for active state
const ACC = (a) => `rgba(55,227,195,${a})`;
const LABEL = "rgba(228,234,246,0.50)",
  LABEL_ON = "#8ef5e2";
const FONT = '"Bahnschrift", "Segoe UI Variable", "Segoe UI", sans-serif';

// quadrant geometry: arc span (deg), label offset, and the flag it reflects
const QUAD = {
  top: { s: 225, e: 315, lx: 0, ly: -OFF, label: "TOP", flag: "T" },
  left: { s: 135, e: 225, lx: -OFF, ly: 0, label: "SAFE", flag: "P" },
  right: { s: -45, e: 45, lx: OFF, ly: 0, label: "THRU", flag: "C" },
  bottom: { s: 45, e: 135, lx: 0, ly: OFF, label: "MORE", flag: null },
};

const canvas = document.getElementById("dial");
const ctx = canvas.getContext("2d");
const moreEl = document.getElementById("more");
const moreMenuEl = document.getElementById("more-menu");
const opacityPanelEl = document.getElementById("opacity-panel");
const procPanelEl = document.getElementById("proc-panel");
const filterEl = document.getElementById("filter");
const listEl = document.getElementById("proclist");
const toastEl = document.getElementById("toast");
const opacityEl = document.getElementById("opacity");
const opacityValEl = document.getElementById("opacity-val");
const contextMenuEl = document.getElementById("context-menu");

const state = {
  pid: null,
  hwnd: null,
  flags: "",
  hubLabel: "aim",
  expanded: false,
  moreOpen: false,
  panel: null,
  procListOpen: false,
  hover: null,
  licenseExists: false,
  licensed: false,
  moveTargetKey: "",
  moveAppKey: "",
  moveStep: 10,
  modifiers: new Set(),
};
let flashMsg = null,
  flashTimer = null;
let listItems = [],
  selIndex = -1;
let contextMenuPos = { x: 0, y: 0 };

// --- drawing ---------------------------------------------------------------
const has = (c) => state.flags.includes(c);
const rad = (d) => (d * Math.PI) / 180;

const isActive = (k) => {
  if (k === "bottom") return state.moreOpen;
  if (k === "left" && !state.licensed) return false;
  return has(QUAD[k].flag);
};

function draw() {
  ctx.clearRect(0, 0, SIZE, SIZE);
  if (state.expanded) {
    // outer ring only when a target is set
    drawDisk();
    for (const k of ["top", "left", "right", "bottom"]) drawQuadrant(k);
    drawDividers();
    drawLabels();
    drawRim();
  }
  drawHub(); // hub (center button) always shows
}

// Deep domed glass disk with a drop shadow and a top sheen.
function drawDisk() {
  ctx.save();
  ctx.beginPath();
  ctx.arc(C, C, R, 0, 2 * Math.PI);
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  const g = ctx.createRadialGradient(C, C - R * 0.55, R * 0.15, C, C, R);
  g.addColorStop(0, "#2c313b");
  g.addColorStop(0.62, "#1c2027");
  g.addColorStop(1, "#13151a");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  // top-down sheen
  ctx.save();
  ctx.beginPath();
  ctx.arc(C, C, R, 0, 2 * Math.PI);
  ctx.clip();
  const s = ctx.createLinearGradient(0, C - R, 0, C + R * 0.2);
  s.addColorStop(0, "rgba(255,255,255,0.11)");
  s.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = s;
  ctx.fillRect(C - R, C - R, 2 * R, 2 * R);
  ctx.restore();
}

// Only draw a quadrant overlay when active (aqua glow) or hovered (faint lift).
function drawQuadrant(k) {
  const q = QUAD[k];
  const active = isActive(k);
  const disabled = k === "left" && !state.licenseExists;
  const hover = state.hover === k && !active && !disabled;
  if (!active && !hover) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(C, C);
  ctx.arc(C, C, R, rad(q.s), rad(q.e));
  ctx.closePath();
  ctx.clip();
  if (active) {
    const mid = rad((q.s + q.e) / 2);
    const gx = C + Math.cos(mid) * R * 0.62,
      gy = C + Math.sin(mid) * R * 0.62;
    const g = ctx.createRadialGradient(gx, gy, 2, C, C, R);
    g.addColorStop(0, ACC(0.34));
    g.addColorStop(1, ACC(0.04));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = disabled
      ? "rgba(120,130,146,0.08)"
      : "rgba(255,255,255,0.055)";
  }
  ctx.fillRect(C - R, C - R, 2 * R, 2 * R);
  ctx.restore();
  if (active) {
    // glowing rim segment
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, R - 1, rad(q.s + 3), rad(q.e - 3));
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 9;
    ctx.stroke();
    ctx.restore();
  }
}

function drawDividers() {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  for (const d of [45, 135, 225, 315]) {
    const a = rad(d);
    ctx.beginPath();
    ctx.moveTo(C + Math.cos(a) * (HUBR + 3), C + Math.sin(a) * (HUBR + 3));
    ctx.lineTo(C + Math.cos(a) * R, C + Math.sin(a) * R);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLabels() {
  ctx.save();
  ctx.font = "600 9px " + FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "1.5px";
  for (const k of ["top", "left", "right", "bottom"]) {
    const q = QUAD[k];
    const disabled = k === "left" && !state.licenseExists;
    ctx.fillStyle = disabled
      ? "rgba(228,234,246,0.18)"
      : isActive(k)
        ? LABEL_ON
        : state.hover === k
          ? "rgba(228,234,246,0.9)"
          : LABEL;
    ctx.fillText(q.label, C + q.lx, C + q.ly);
  }
  ctx.restore();
}

function drawRim() {
  ctx.save();
  ctx.beginPath();
  ctx.arc(C, C, R, 0, 2 * Math.PI);
  ctx.strokeStyle = "rgba(255,255,255,0.13)"; // light top edge
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(C, C, R - 1.5, 0, 2 * Math.PI);
  ctx.strokeStyle = "rgba(0,0,0,0.35)"; // inner depth line
  ctx.stroke();
  ctx.restore();
}

// Raised glassy hub: radial light, specular cap, accent ring when idle/hovered.
function drawHub() {
  const idle = !state.hwnd;
  ctx.save();
  ctx.beginPath();
  ctx.arc(C, C, HUBR, 0, 2 * Math.PI);
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  const g = ctx.createRadialGradient(C, C - HUBR * 0.5, 2, C, C, HUBR);
  g.addColorStop(0, idle ? "#3b4651" : "#454d5a");
  g.addColorStop(1, "#22252d");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  if (idle || state.hover === "hub") {
    // accent ring (invites action)
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, HUBR, 0, 2 * Math.PI);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = idle ? 9 : 5;
    ctx.globalAlpha = idle ? 0.9 : 0.6;
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(C, C, HUBR, 0, 2 * Math.PI);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.save(); // specular cap
  ctx.beginPath();
  ctx.ellipse(C, C - HUBR * 0.42, HUBR * 0.55, HUBR * 0.3, 0, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(255,255,255,0.11)";
  ctx.fill();
  ctx.restore();

  ctx.save(); // label
  ctx.font = "600 9px " + FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = idle ? "1.5px" : "0px";
  ctx.fillStyle = idle ? ACC(0.92) : "#eef2f8";
  const label = flashMsg || (idle ? "AIM" : state.hubLabel);
  ctx.fillText(label.slice(0, 7), C, C);
  ctx.restore();
}

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
}

function setHub(text) {
  state.hubLabel = text;
  draw();
}
function flash(msg) {
  flashMsg = msg;
  draw();
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashMsg = null;
    draw();
  }, 1100);
}

function resizeToContent() {
  requestAnimationFrame(() => {
    const root = document.getElementById("root");
    let w = root.offsetWidth || 150;
    let h = root.offsetHeight || 150;
    if (state.procListOpen && !procPanelEl.classList.contains("hidden")) {
      const panelRect = procPanelEl.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      w = Math.max(w, Math.ceil(panelRect.right - rootRect.left + 12));
      h = Math.max(h, Math.ceil(panelRect.bottom - rootRect.top + 12));
    }
    api.resize(w, h);
  });
}

function positionProcPanel() {
  const root = document.getElementById("root");
  const dialRect = canvas.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const panelW = procPanelEl.offsetWidth;
  const left = Math.max(
    8,
    dialRect.left - rootRect.left + (dialRect.width - panelW) / 2,
  );
  const top = dialRect.bottom - rootRect.top + 10;
  procPanelEl.style.left = `${left}px`;
  procPanelEl.style.top = `${top}px`;
}

function normalizeModifier(value) {
  const token = String(value || "")
    .trim()
    .toLowerCase();
  if (["control", "ctrl"].includes(token)) return "ctrl";
  if (["alt", "option"].includes(token)) return "alt";
  if (["shift"].includes(token)) return "shift";
  if (["meta", "cmd", "command", "super", "win", "windows"].includes(token))
    return "meta";
  return "";
}

function parseModifierChord(value) {
  return new Set(
    String(value || "")
      .split("+")
      .map(normalizeModifier)
      .filter(Boolean),
  );
}

function parseChordSignature(value) {
  const chord = parseModifierChord(value);
  return {
    ctrl: chord.has("ctrl"),
    alt: chord.has("alt"),
    shift: chord.has("shift"),
    meta: chord.has("meta"),
    size: chord.size,
  };
}

function eventMatchesChord(event, chordText) {
  const want = parseChordSignature(chordText);
  if (!want.size) return false;
  const have = {
    ctrl: !!event.ctrlKey,
    alt: !!event.altKey,
    shift: !!event.shiftKey,
    meta: !!event.metaKey,
  };
  if (have.ctrl !== want.ctrl) return false;
  if (have.alt !== want.alt) return false;
  if (have.shift !== want.shift) return false;
  if (have.meta !== want.meta) return false;
  return true;
}

function modifierSetFromEvent() {
  const set = new Set();
  if (state.modifiers.has("ctrl")) set.add("ctrl");
  if (state.modifiers.has("alt")) set.add("alt");
  if (state.modifiers.has("shift")) set.add("shift");
  if (state.modifiers.has("meta")) set.add("meta");
  return set;
}

function chordIsActive(chord) {
  const want = parseModifierChord(chord);
  if (!want.size) return false;
  const have = modifierSetFromEvent();
  if (want.size !== have.size) return false;
  for (const mod of want) if (!have.has(mod)) return false;
  return true;
}

function moveControllerEnabled() {
  return chordIsActive(state.moveAppKey);
}

function applySettingsSnapshot(snapshot) {
  if (!snapshot) return;
  state.licenseExists = !!snapshot.exists;
  state.moveTargetKey = (snapshot.moveTargetKey || "").trim();
  state.moveAppKey = (snapshot.moveAppKey || "").trim();
  state.moveStep = Math.max(
    1,
    Math.min(500, Math.round(snapshot.moveStep || 10)),
  );
}

async function refreshLicense() {
  try {
    const result = await api.licenseStatus();
    state.licenseExists = !!(result && result.exists);
    state.licensed = !!(result && result.enabled);
    draw();
  } catch {
    state.licenseExists = false;
    state.licensed = false;
    draw();
  }
}

function closeContextMenu() {
  contextMenuEl.classList.add("hidden");
}

function closeContextProcList() {
  if (!state.procListOpen) return;
  state.procListOpen = false;
  procPanelEl.classList.add("hidden");
  resizeToContent();
}

function showContextMenu(x, y) {
  closeContextProcList();
  contextMenuPos = { x, y };
  contextMenuEl.classList.remove("hidden");
  const root = document.getElementById("root");
  const bounds = root.getBoundingClientRect();
  contextMenuEl.style.left = `${Math.max(8, x - bounds.left)}px`;
  contextMenuEl.style.top = `${Math.max(8, y - bounds.top)}px`;
  const menuRect = contextMenuEl.getBoundingClientRect();
  const maxLeft = bounds.width - menuRect.width - 8;
  const maxTop = bounds.height - menuRect.height - 8;
  contextMenuEl.style.left = `${Math.max(8, Math.min(x - bounds.left, maxLeft))}px`;
  contextMenuEl.style.top = `${Math.max(8, Math.min(y - bounds.top, maxTop))}px`;
}

function openContextProcList() {
  closeContextMenu();
  state.procListOpen = true;
  procPanelEl.classList.remove("hidden");
  positionProcPanel();
  populate().then(() => {
    positionProcPanel();
    resizeToContent();
  });
}

async function moveSelectedWindow(dx, dy) {
  if (!state.hwnd) {
    flash("aim 1st");
    return;
  }
  const step = Math.max(1, state.moveStep || 10);
  const res = await api.bridge({
    cmd: "move",
    hwnd: state.hwnd,
    dx: dx * step,
    dy: dy * step,
  });
  if (res.ok === false) showToast(res.msg || "move failed");
  api.raise();
}

async function moveController(dx, dy) {
  const step = Math.max(1, state.moveStep || 10);
  const pos = await api.winPos();
  await api.setWinPos(pos.x + dx * step, pos.y + dy * step);
}

function moveSelectedWindowByKey(e) {
  if (!state.hwnd) return false;
  if (!eventMatchesChord(e, state.moveTargetKey)) return false;
  const arrows = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  const delta = arrows[e.key];
  if (!delta) return false;
  e.preventDefault();
  moveSelectedWindow(delta[0], delta[1]);
  return true;
}

function moveControllerByKey(e) {
  if (!eventMatchesChord(e, state.moveAppKey)) return false;
  const arrows = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  };
  const delta = arrows[e.key];
  if (!delta) return false;
  e.preventDefault();
  moveController(delta[0], delta[1]);
  return false;
}

// --- hit testing -----------------------------------------------------------
function hit(x, y) {
  const dx = x - C,
    dy = y - C,
    d = Math.hypot(dx, dy);
  if (d <= HUBR) return "hub";
  if (!state.expanded || d > R) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "bottom" : "top";
}

// --- pointer interaction ---------------------------------------------------
// No target  -> dragging the hub PICKS a target; the window is NOT movable.
// Target set or move-app chord held -> dragging the dial moves the controller.
// A click on the hub UNSELECTS the target, a click on a quadrant toggles its flag.
let press = null; // {sx, sy, zone, win, moved, mode}
const MOVE_THRESHOLD = 8;

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("contextmenu", (e) => {
  if (
    e.target === canvas ||
    document.getElementById("root").contains(e.target)
  ) {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  }
});

window.addEventListener(
  "pointerdown",
  (e) => {
    if (!contextMenuEl.classList.contains("hidden")) {
      if (!contextMenuEl.contains(e.target)) closeContextMenu();
    }
    if (state.procListOpen && !procPanelEl.contains(e.target))
      closeContextProcList();
  },
  true,
);

contextMenuEl.addEventListener("click", (e) => {
  const button = e.target.closest("button");
  if (!button) return;
  if (button.dataset.act === "proclist") openContextProcList();
  else if (button.dataset.act === "settings") {
    closeContextMenu();
    api.openSettings();
  } else if (button.dataset.act === "quit") {
    closeContextMenu();
    api.quit();
  }
});

canvas.addEventListener("mousedown", async (e) => {
  if (e.button !== 0) return;
  closeContextMenu();
  press = {
    sx: e.screenX,
    sy: e.screenY,
    zone: hit(e.offsetX, e.offsetY),
    moved: false,
    win: null,
    mode: moveControllerEnabled() || state.hwnd ? "move" : "pick",
  };
  if (press.mode === "move") press.win = await api.winPos();
});

window.addEventListener("mousemove", (e) => {
  if (!press) {
    updateClickThrough(e);
    return;
  }
  if (Math.hypot(e.screenX - press.sx, e.screenY - press.sy) > MOVE_THRESHOLD)
    press.moved = true;
  if (press.mode === "move" && press.win) {
    api.setWinPos(
      press.win.x + (e.screenX - press.sx),
      press.win.y + (e.screenY - press.sy),
    );
  }
});

window.addEventListener("mouseup", () => {
  if (!press) return;
  const p = press;
  press = null;
  if (p.mode === "pick") {
    // no target: gesture = pick
    if (p.moved) doPick();
    else flash("drag");
    return;
  }
  if (p.moved) return; // it was a move, not a click
  if (p.zone === "hub")
    unselectTarget(); // click hub -> unselect
  else if (p.zone === "bottom") toggleMore();
  else if (p.zone) activate(p.zone);
});

function within(e, el) {
  const r = el.getBoundingClientRect();
  return (
    e.clientX >= r.left &&
    e.clientX <= r.right &&
    e.clientY >= r.top &&
    e.clientY <= r.bottom
  );
}

function updateClickThrough(e) {
  const r = canvas.getBoundingClientRect();
  const lx = e.clientX - r.left,
    ly = e.clientY - r.top;
  const overDial =
    Math.hypot(lx - C, ly - C) <= (state.expanded ? R : HUBR) + 2;
  const overMore = state.moreOpen && within(e, moreEl);
  const overMenu =
    !contextMenuEl.classList.contains("hidden") && within(e, contextMenuEl);
  const overProc = state.procListOpen && within(e, procPanelEl);
  api.ignoreMouse(!(overDial || overMore || overMenu || overProc));
  const hz = overDial ? hit(lx, ly) : null; // light up the hovered zone
  if (hz !== state.hover) {
    state.hover = hz;
    draw();
  }
}

// --- actions ---------------------------------------------------------------
function selectTarget(pid, hwnd, name, flags) {
  state.pid = pid;
  state.hwnd = hwnd;
  state.hubLabel = name;
  state.flags = flags;
  state.expanded = true; // ring shows whenever a target is selected
  draw();
  resizeToContent();
}

function unselectTarget() {
  state.pid = null;
  state.hwnd = null;
  state.hubLabel = "aim";
  state.flags = "";
  state.expanded = false;
  closeMore();
  draw();
  resizeToContent();
}

async function doPick() {
  const exclude = await api.ourHwnd();
  const res = await api.bridge({ cmd: "pick_cursor", exclude });
  if (!res || !res.hwnd) {
    flash("none");
    return;
  }
  const f = await api.bridge({ cmd: "flags", hwnd: res.hwnd });
  selectTarget(res.pid, res.hwnd, res.title || String(res.pid), f.flags);
}

async function activate(zone) {
  if (zone === "bottom") {
    toggleMore();
    return;
  }
  if (!state.hwnd) {
    flash("aim 1st");
    return;
  }
  if (zone === "left" && !state.licenseExists) {
    return;
  }
  const map = { top: "top", left: "safe", right: "through" };
  const want = { top: !has("T"), left: !has("P"), right: !has("C") }[zone];
  const res = await api.bridge({
    cmd: "set",
    hwnd: state.hwnd,
    flag: map[zone],
    value: want,
  });
  state.flags = res.flags;
  draw();
  if (res.ok === false) showToast(res.msg || "action failed");
  api.raise(); // a target set Top may have jumped above us; float back up
}

// A global hotkey fired in the main process; run it against the target.
function runHotkey(action) {
  if (!state.hwnd) {
    flash("aim 1st");
    return;
  }
  if (action === "safe" && !state.licenseExists) {
    return;
  }
  if (action === "opacity_up") {
    stepOpacity(+OPACITY_STEP);
    return;
  }
  if (action === "opacity_down") {
    stepOpacity(-OPACITY_STEP);
    return;
  }
  const zone = { safe: "left", through: "right", top: "top" }[action];
  if (zone) activate(zone);
}

// Hotkey opacity: nudge up/down by OPACITY_STEP percent, clamped to 10..100%.
const OPACITY_STEP = 10;
async function stepOpacity(delta) {
  const pct = Math.max(10, Math.min(100, +opacityEl.value + delta));
  setOpacityLabel(pct);
  await onOpacity();
}

// --- "more" panel ----------------------------------------------------------
// MORE opens a menu of buttons (Opacity / Process list); each button reveals
// its control panel below, accordion-style.
function toggleMore() {
  state.moreOpen ? closeMore() : openMore();
}

function openMore() {
  state.moreOpen = true;
  moreEl.classList.remove("hidden");
  draw();
  resizeToContent();
}

// state.panel is the open detail panel: "opacity" or null.
function applyPanelState() {
  const k = state.panel;
  opacityPanelEl.classList.toggle("hidden", k !== "opacity");
  moreMenuEl
    .querySelectorAll("button.open")
    .forEach((b) => b.classList.remove("open"));
  if (k === "opacity") {
    const b = moreMenuEl.querySelector(`button[data-panel="${k}"]`);
    if (b) b.classList.add("open");
  }
}

// Show the named control panel (or collapse it if already open).
function togglePanel(name) {
  state.panel = state.panel === name ? null : name;
  applyPanelState();
  if (state.panel === "opacity") syncOpacity();
  resizeToContent();
}

async function syncOpacity() {
  if (!state.hwnd) {
    setOpacityLabel(100);
    return;
  }
  const r = await api.bridge({ cmd: "alpha", hwnd: state.hwnd });
  setOpacityLabel(Math.round((r.alpha / 255) * 100));
}

function setOpacityLabel(pct) {
  opacityEl.value = pct;
  opacityValEl.textContent = pct + "%";
}

async function onOpacity() {
  const pct = +opacityEl.value;
  opacityValEl.textContent = pct + "%";
  if (!state.hwnd) return;
  const alpha = Math.round((pct / 100) * 255);
  const res = await api.bridge({
    cmd: "set",
    hwnd: state.hwnd,
    flag: "opacity",
    value: alpha,
  });
  state.flags = res.flags;
  if (res.ok === false) showToast(res.msg || "opacity failed");
}

function closeMore() {
  if (!state.moreOpen) return;
  state.moreOpen = false;
  state.panel = null;
  moreEl.classList.add("hidden");
  applyPanelState(); // hides all panels, clears button highlights
  draw();
  resizeToContent();
}

async function populate() {
  const res = await api.bridge({ cmd: "list", needle: filterEl.value });
  listItems = res.procs.sort((a, b) => {
    const af = a.flags ? 1 : 0;
    const bf = b.flags ? 1 : 0;
    if (af !== bf) return bf - af;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  selIndex = -1;
  listEl.innerHTML = "";
  listItems.forEach((p, i) => {
    const li = document.createElement("li");
    if (p.flags) {
      li.classList.add("flagged");
      li.title = "flags: " + p.flags;
    }
    const flagCol = document.createElement("span");
    flagCol.className = "flag-col";
    flagCol.textContent = p.flags || "";
    li.appendChild(flagCol);
    const text = document.createElement("span");
    text.className = "proc-text";
    text.textContent = `${String(p.pid).padStart(6)}  ${p.name}`;
    li.appendChild(text);
    li.onclick = () => select(i);
    li.ondblclick = () => {
      select(i);
      useSelected();
    };
    listEl.appendChild(li);
  });
}

function select(i) {
  selIndex = i;
  [...listEl.children].forEach((li, idx) =>
    li.classList.toggle("sel", idx === i),
  );
}

async function useSelected() {
  if (selIndex < 0) {
    flash("select");
    return;
  }
  const p = listItems[selIndex];
  const r = await api.bridge({ cmd: "main_window", pid: p.pid });
  if (!r.hwnd) {
    flash("no win");
    return;
  }
  const f = await api.bridge({ cmd: "flags", hwnd: r.hwnd });
  selectTarget(p.pid, r.hwnd, p.name, f.flags);
}

async function restore() {
  if (!state.hwnd) {
    flash("aim 1st");
    return;
  }
  const res = await api.bridge({
    cmd: "set",
    hwnd: state.hwnd,
    flag: "restore",
  });
  state.flags = res.flags;
  draw();
  flash("reset");
}

moreMenuEl.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.panel) togglePanel(b.dataset.panel);
  else if (b.dataset.act === "settings") api.openSettings();
  else if (b.dataset.act === "restore") restore();
});
document.getElementById("proc-actions").addEventListener("click", (e) => {
  const act = e.target.dataset.act;
  if (act === "use") useSelected();
  else if (act === "refresh") populate();
});
filterEl.addEventListener("input", populate);
opacityEl.addEventListener("input", onOpacity);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeContextMenu();
    closeContextProcList();
    return;
  }
  if (moveSelectedWindowByKey(e)) return;
  if (moveControllerByKey(e)) return;
  if (e.key === "Control") state.modifiers.add("ctrl");
  else if (e.key === "Alt") state.modifiers.add("alt");
  else if (e.key === "Shift") state.modifiers.add("shift");
  else if (e.key === "Meta") state.modifiers.add("meta");
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Control") state.modifiers.delete("ctrl");
  else if (e.key === "Alt") state.modifiers.delete("alt");
  else if (e.key === "Shift") state.modifiers.delete("shift");
  else if (e.key === "Meta") state.modifiers.delete("meta");
});
window.addEventListener("blur", () => {
  state.modifiers.clear();
  closeContextMenu();
  closeContextProcList();
});

api.onSettingsChanged((snapshot) => applySettingsSnapshot(snapshot));
api.licenseStatus().then((snapshot) => {
  state.licenseExists = !!(snapshot && snapshot.exists);
  state.licensed = !!(snapshot && snapshot.enabled);
  draw();
});
api.getSettings().then((snapshot) => applySettingsSnapshot(snapshot));
setInterval(refreshLicense, 5000);

// --- init ------------------------------------------------------------------
function setupCanvas() {
  const dpr = window.devicePixelRatio || 1; // crisp on high-DPI displays
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.width = SIZE + "px";
  canvas.style.height = SIZE + "px";
  ctx.scale(dpr, dpr);
}

canvas.addEventListener("mouseleave", () => {
  if (state.hover !== null) {
    state.hover = null;
    draw();
  }
});

setupCanvas();
api.ignoreMouse(false);
api.onHotkey(runHotkey);
draw();
resizeToContent();
