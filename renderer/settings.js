"use strict";
// Settings window: tabbed — Self control / Hotkey control.

document.addEventListener(
  "click",
  (e) => {
    const target =
      e.target && e.target.id ? e.target.id : e.target?.tagName || "";
    if (target === "close") requestClose("header close");
    else if (target === "quit") requestQuit("header quit");
  },
  true,
);

// --- tabs ------------------------------------------------------------------
document.querySelectorAll(".tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    document
      .querySelectorAll(".tabs button")
      .forEach((x) => x.classList.remove("active"));
    document
      .querySelectorAll(".tabpane")
      .forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    document.getElementById("tab-" + b.dataset.tab).classList.add("active");
  });
});

// --- self control ----------------------------------------------------------
const protectEl = document.getElementById("protect");
const topEl = document.getElementById("top");
const opEl = document.getElementById("op");
const opValEl = document.getElementById("op-val");
const moveTargetEl = document.getElementById("move-target-key");
const moveAppEl = document.getElementById("move-app-key");
const moveStepEl = document.getElementById("move-step");
const moveStepValEl = document.getElementById("move-step-val");

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
  moveTargetEl.value = s.moveTargetKey || "";
  moveAppEl.value = s.moveAppKey || "";
  const step = Math.max(1, Math.min(500, Math.round(s.moveStep || 10)));
  moveStepEl.value = step;
  moveStepValEl.textContent = step + " px";
})();

protectEl.addEventListener("change", () =>
  settings.setProtect(protectEl.checked),
);
topEl.addEventListener("change", () => settings.setTop(topEl.checked));
opEl.addEventListener("input", () => {
  const pct = +opEl.value;
  opValEl.textContent = pct + "%";
  settings.setOpacity(pct / 100);
});

function saveMotion(which, value) {
  if (which === "target") settings.setMoveTargetKey(value.trim());
  else if (which === "app") settings.setMoveAppKey(value.trim());
}

moveTargetEl.addEventListener("change", () =>
  saveMotion("target", moveTargetEl.value),
);
moveTargetEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveMotion("target", moveTargetEl.value);
  }
});
moveAppEl.addEventListener("change", () => saveMotion("app", moveAppEl.value));
moveAppEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveMotion("app", moveAppEl.value);
  }
});
moveStepEl.addEventListener("input", () => {
  const step = +moveStepEl.value;
  moveStepValEl.textContent = step + " px";
  settings.setMoveStep(step);
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
    setStatus(
      hkStatus,
      accel ? `${action}: ${accel}` : `${action} cleared`,
      "ok",
    );
  else setStatus(hkStatus, `${action}: ${res.msg || "failed"}`, "err");
}
document.querySelectorAll(".hk-row").forEach((row) => {
  const action = row.dataset.action;
  const input = row.querySelector(".hk");
  row.querySelector(".set").onclick = () =>
    saveHotkey(action, input.value.trim());
  row.querySelector(".clr").onclick = () => {
    input.value = "";
    saveHotkey(action, "");
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveHotkey(action, input.value.trim());
    }
  });
});

let closeRequested = false;
let quitRequested = false;

function requestClose(reason) {
  if (closeRequested) return;
  closeRequested = true;
  settings.close();
}

function requestQuit(reason) {
  if (quitRequested) return;
  quitRequested = true;
  settings.quit();
}

const closeButton = document.getElementById("close");
closeButton.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  requestClose("close button pointerdown");
});
closeButton.addEventListener("click", (e) => {
  e.preventDefault();
  requestClose("close button click");
});
const quitButton = document.getElementById("quit");
quitButton.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  requestQuit("quit button pointerdown");
});
quitButton.addEventListener("click", (e) => {
  e.preventDefault();
  requestQuit("quit button click");
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") requestClose("Escape pressed");
});
