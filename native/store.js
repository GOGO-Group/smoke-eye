"use strict";
// Tiny JSON settings store under the OS user-data dir (e.g.
// %APPDATA%/floating-controller/settings.json) so controller settings — self
// toggles, hotkeys, last window position — persist across restarts.
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const FILE = () => path.join(app.getPath("userData"), "settings.json");

// Load saved settings merged over `defaults`. hotkeys is merged one level deeper
// so a newly added action keeps its default when older files lack it.
function load(defaults) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE(), "utf8")); }
  catch { /* first run or unreadable -> defaults */ }
  return {
    ...defaults, ...saved,
    hotkeys: { ...defaults.hotkeys, ...(saved.hotkeys || {}) },
  };
}

function save(data) {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error("[store] save failed:", e.message);
    return false;
  }
}

module.exports = { load, save, path: FILE };
