"use strict";
// Self-heal: if we were started with ELECTRON_RUN_AS_NODE set (VS Code and some
// terminals export it for child processes), the Electron binary runs as plain
// Node, require("electron") yields a path string, and the app crashes at the
// first API call. Relaunch ourselves with the flag cleared, then exit. This is
// loop-safe — the relaunched process's env no longer has the flag — and fails
// safe: if the relaunch can't start, we just exit as before.
if (process.env.ELECTRON_RUN_AS_NODE) {
  const cp = require("child_process");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    cp.spawn(process.execPath, process.argv.slice(1), {
      env,
      detached: true,
      stdio: "inherit",
    }).unref();
  } catch {
    /* fall through to exit */
  }
  process.exit(0);
}

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  globalShortcut,
} = require("electron");
const path = require("path");
const backend = require("./native/backend"); // supervised utilityProcess (koffi/Win32)
const license = require("./native/license");
const store = require("./native/store"); // persisted settings (JSON on disk)

// When the app runs elevated (our requireAdministrator manifest), Chromium's
// *sandboxed* GPU process can't initialize under high integrity and fails to
// launch ("GPU process launch failed: error_code=18" -> FATAL "GPU process
// isn't usable. Goodbye."), terminating the app. The problem is the sandbox,
// not the GPU — so we drop the sandbox but KEEP GPU acceleration on. (Turning
// the GPU off instead makes our transparent frameless window render invisibly
// on Windows.) Must run before the app is ready.
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu-sandbox");

let win = null;
let settingsWin = null;

// Live controller-window settings, edited from the settings window.
// hotkeys: accelerator string per target-window action (empty = unbound).
// Loaded from disk so toggles + hotkeys persist across restarts; persist()
// writes back on every change.
const HOTKEY_ACTIONS = ["safe", "through", "top", "opacity_up", "opacity_down"];
const SETTINGS_DEFAULTS = {
  protect: true,
  top: true,
  opacity: 1,
  bounds: null, // {x, y} of the dial, remembered across restarts
  moveTargetKey: "",
  moveAppKey: "",
  moveStep: 10,
  hotkeys: { safe: "", through: "", top: "", opacity_up: "", opacity_down: "" },
};
const settings = store.load(SETTINGS_DEFAULTS);
const persist = () => store.save(settings);

function broadcastSettings() {
  if (!win || win.isDestroyed() || !win.webContents) return;
  win.webContents.send("settings:changed", { ...settings });
}

// The koffi/Win32 backend lives in native/backend.js (a supervised
// utilityProcess). call() forwards to it; it is started on app-ready and
// stopped on quit. See that module for freeze-avoidance + auto-respawn.
const call = (cmd) => backend.call(cmd);

// --- window ----------------------------------------------------------------
function appIcon() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(__dirname, "build", "icon.ico");
}

// True if (x, y) falls on some currently-connected display, so we don't reopen
// the dial off-screen after a monitor change.
function isOnScreen(x, y) {
  return screen
    .getAllDisplays()
    .some(
      ({ bounds: b }) =>
        x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height,
    );
}

// Remember where the user parks the dial (debounced; the renderer nudges the
// window many times during a drag) so it reopens there next launch.
let savePosTimer = null;
function saveWinPos() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  settings.bounds = { x, y };
  persist();
}

function createWindow() {
  const b = settings.bounds;
  const place = b && isOnScreen(b.x, b.y) ? { x: b.x, y: b.y } : {};
  win = new BrowserWindow({
    width: 220,
    height: 168,
    ...place,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    icon: appIcon(),
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  win.setContentProtection(settings.protect); // P flag on ourselves: keep the
  // controller out of screen captures / shares
  if (settings.top) raise();
  else win.setAlwaysOnTop(false);
  if (settings.opacity !== 1) win.setOpacity(settings.opacity);
  win.on("close", saveWinPos); // capture the final position before teardown
  win.webContents.on("did-finish-load", broadcastSettings);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  // Re-assert position above the topmost band so other apps that turn on
  // always-on-top can't permanently cover this controller. Pause while the
  // settings window is open (so it isn't yanked behind the dial) and when the
  // user has switched always-on-top off.
  setInterval(() => {
    if (
      settings.top &&
      win &&
      !win.isDestroyed() &&
      !(settingsWin && !settingsWin.isDestroyed())
    )
      win.moveTop();
  }, 1200);
}

// --- settings window -------------------------------------------------------
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 320,
    height: 380,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, "settings-preload.js") },
  });
  settingsWin.setContentProtection(true); // settings stay out of capture too
  settingsWin.setAlwaysOnTop(true, "screen-saver");
  settingsWin.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWin.on("closed", () => {
    settingsWin = null;
  });
}

// Put the window at the very top of the always-on-top band (no focus steal).
function raise() {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, "screen-saver");
  win.moveTop();
}

function ourHwnd() {
  if (!win) return 0;
  const b = win.getNativeWindowHandle();
  return Number(b.length === 8 ? b.readBigUInt64LE() : b.readUInt32LE());
}

// --- global hotkeys --------------------------------------------------------
// Each bound accelerator forwards its action to the renderer, which runs it
// against the currently selected target window (same path as a quadrant click).
function applyHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const action of HOTKEY_ACTIONS) {
    const accel = settings.hotkeys[action];
    if (!accel) continue;
    try {
      const ok = globalShortcut.register(accel, () => {
        if (win && !win.isDestroyed()) win.webContents.send("hotkey", action);
      });
      if (!ok) failed.push(action);
    } catch {
      failed.push(action);
    }
  }
  return failed;
}

// Set one action's accelerator and re-apply the whole set.
function setHotkey(action, accel) {
  if (!HOTKEY_ACTIONS.includes(action))
    return { ok: false, msg: "unknown action" };
  settings.hotkeys[action] = (accel || "").trim();
  const failed = applyHotkeys();
  persist();
  if (failed.includes(action))
    return { ok: false, msg: "could not register (in use?)" };
  return { ok: true };
}

ipcMain.handle("bridge", (_e, cmd) => call(cmd));
ipcMain.handle("cursorPos", () => screen.getCursorScreenPoint());
ipcMain.handle("winPos", () => {
  const [x, y] = win.getPosition();
  return { x, y };
});
ipcMain.handle("ourHwnd", () => ourHwnd());
ipcMain.handle("license:get", () => license.status());
ipcMain.on("setWinPos", (_e, { x, y }) => {
  if (!win) return;
  win.setPosition(Math.round(x), Math.round(y));
  clearTimeout(savePosTimer); // debounce: save once the drag settles
  savePosTimer = setTimeout(saveWinPos, 400);
});
ipcMain.on("resize", (_e, { w, h }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setBounds({ x, y, width: Math.round(w), height: Math.round(h) });
});
ipcMain.on(
  "ignoreMouse",
  (_e, ignore) => win && win.setIgnoreMouseEvents(!!ignore, { forward: true }),
);
ipcMain.on("raise", () => raise());
ipcMain.on("openSettings", () => openSettings());

ipcMain.handle("settings:get", () => ({ ...settings }));
ipcMain.on("settings:setProtect", (_e, v) => {
  settings.protect = !!v;
  persist();
  if (win) win.setContentProtection(!!v);
  broadcastSettings();
});
ipcMain.on("settings:setTop", (_e, v) => {
  settings.top = !!v;
  persist();
  if (!win) return;
  if (v) raise();
  else win.setAlwaysOnTop(false);
  broadcastSettings();
});
ipcMain.on("settings:setOpacity", (_e, v) => {
  settings.opacity = v;
  persist();
  if (win) win.setOpacity(v);
  broadcastSettings();
});
ipcMain.on("settings:setMoveTargetKey", (_e, v) => {
  settings.moveTargetKey = (v || "").trim();
  persist();
  broadcastSettings();
});
ipcMain.on("settings:setMoveAppKey", (_e, v) => {
  settings.moveAppKey = (v || "").trim();
  persist();
  broadcastSettings();
});
ipcMain.on("settings:setMoveStep", (_e, v) => {
  const step = Math.max(1, Math.min(500, Math.round(Number(v) || 0)));
  settings.moveStep = step;
  persist();
  broadcastSettings();
});
ipcMain.handle("settings:setHotkey", (_e, { action, accel }) =>
  setHotkey(action, accel),
);
ipcMain.on("settings:close", () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});

ipcMain.on("quit", () => app.quit());

app.whenReady().then(() => {
  backend.start();
  createWindow();
  applyHotkeys();
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  backend.stop();
});
