"use strict";
// Settings window: tabbed — Self control / Hotkey control.

// --- tabs ------------------------------------------------------------------
document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".tabpane").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    document.getElementById("tab-" + b.dataset.tab).classList.add("active");
  });
});

// --- self control ----------------------------------------------------------
const protectEl = document.getElementById("protect");
const topEl = document.getElementById("top");
const opEl = document.getElementById("op");
const opValEl = document.getElementById("op-val");

(async () => {
  const s = await settings.get();
  protectEl.checked = !!s.protect;
  topEl.checked = !!s.top;
  const pct = Math.round((s.opacity ?? 1) * 100);
  opEl.value = pct;
  opValEl.textContent = pct + "%";
  const hk = s.hotkeys || {};
  document.querySelectorAll(".hk-row").forEach((row) => {
    row.querySelector(".hk").value = hk[row.dataset.action] || "";
  });
})();

protectEl.addEventListener("change", () => settings.setProtect(protectEl.checked));
topEl.addEventListener("change", () => settings.setTop(topEl.checked));
opEl.addEventListener("input", () => {
  const pct = +opEl.value;
  opValEl.textContent = pct + "%";
  settings.setOpacity(pct / 100);
});

// --- hotkey control --------------------------------------------------------
const hkStatus = document.getElementById("hk-status");
function setStatus(el, msg, kind) {
  el.textContent = msg || "";
  el.className = "status" + (kind ? " " + kind : "");
}
async function saveHotkey(action, accel) {
  const res = await settings.setHotkey(action, accel);
  if (res.ok)
    setStatus(hkStatus, accel ? `${action}: ${accel}` : `${action} cleared`, "ok");
  else
    setStatus(hkStatus, `${action}: ${res.msg || "failed"}`, "err");
}
document.querySelectorAll(".hk-row").forEach((row) => {
  const action = row.dataset.action;
  const input = row.querySelector(".hk");
  row.querySelector(".set").onclick = () => saveHotkey(action, input.value.trim());
  row.querySelector(".clr").onclick = () => { input.value = ""; saveHotkey(action, ""); };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveHotkey(action, input.value.trim()); }
  });
});

document.getElementById("close").addEventListener("click", () => settings.close());
document.getElementById("quit").addEventListener("click", () => settings.quit());
window.addEventListener("keydown", (e) => { if (e.key === "Escape") settings.close(); });
