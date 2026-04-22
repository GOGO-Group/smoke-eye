const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  globalShortcut,
  screen,
  dialog,
  desktopCapturer,
  clipboard,
} = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");

const isDev = !!process.env.VITE_DEV;
const DEV_URL = "http://localhost:5173";
const DIST = path.join(__dirname, "..", "dist");

let mainWindow;
let stickyWindow = null;
let currentStickyNoteId = null;
let tcpServer = null;
let tcpClient = null;

const MOVE_STEP = 40;
const DEFAULT_SIZES = {
  mobile: { w: 420, h: 780 },
  tablet: { w: 900, h: 700 },
};
let contentProtected = false;

const settingsPath = path.join(app.getPath("userData"), "settings.json");

const defaultSettings = {
  hotkeys: {
    sizeMobile: "CommandOrControl+Alt+1",
    sizeTablet: "CommandOrControl+Alt+2",
    toggleShow: "CommandOrControl+Alt+H",
    toggleProtection: "CommandOrControl+Alt+P",
    moveUp: "CommandOrControl+Alt+Up",
    moveDown: "CommandOrControl+Alt+Down",
    moveLeft: "CommandOrControl+Alt+Left",
    moveRight: "CommandOrControl+Alt+Right",
    helpRequest: "CommandOrControl+Alt+/",
    focusCaption: "CommandOrControl+Alt+4",
    focusWeb: "CommandOrControl+Alt+5",
    focusChat: "CommandOrControl+Alt+6",
    toggleSticky: "CommandOrControl+Alt+S",
    stickyPrev: "CommandOrControl+Alt+[",
    stickyNext: "CommandOrControl+Alt+]",
    captureArea: "CommandOrControl+Alt+C",
    opacityUp: "CommandOrControl+Alt+Equal",
    opacityDown: "CommandOrControl+Alt+-",
  },
  sizes: { mobile: { w: 420, h: 780 }, tablet: { w: 900, h: 700 } },
  webpages: ["https://example.com", "https://developer.mozilla.org"],
  themeMode: "dark",
};

let settings = loadSettings();

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      hotkeys: { ...defaultSettings.hotkeys, ...(parsed.hotkeys || {}) },
      sizes: { ...defaultSettings.sizes, ...(parsed.sizes || {}) },
      webpages: Array.isArray(parsed.webpages)
        ? parsed.webpages
        : defaultSettings.webpages,
      themeMode: parsed.themeMode === 'light' ? 'light' : 'dark',
    };
  } catch {
    return JSON.parse(JSON.stringify(defaultSettings));
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error("save settings failed", e);
  }
}

function loadRenderer(win, page) {
  if (isDev) win.loadURL(`${DEV_URL}/${page}`);
  else win.loadFile(path.join(DIST, page));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 380,
    minHeight: 500,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: "#121212",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  loadRenderer(mainWindow, "index.html");

  mainWindow.setContentProtection(true);
  mainWindow.setAlwaysOnTop(true, "screen-saver");

  mainWindow.on("maximize", () =>
    mainWindow.webContents.send("win-state", { maximized: true }),
  );
  mainWindow.on("unmaximize", () =>
    mainWindow.webContents.send("win-state", { maximized: false }),
  );
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (stickyWindow && !stickyWindow.isDestroyed()) stickyWindow.close();
  });
}

// ---------- window controls IPC ----------
ipcMain.on("win-ctrl", (_e, cmd) => {
  if (!mainWindow) return;
  if (cmd === "minimize") mainWindow.minimize();
  else if (cmd === "maximize")
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  else if (cmd === "close") mainWindow.close();
});

ipcMain.handle("win-is-maximized", () => mainWindow?.isMaximized() ?? false);

ipcMain.on("win-opacity", (_e, value) => {
  if (mainWindow) mainWindow.setOpacity(value);
});

ipcMain.on("win-content-protection", (_e, on) => {
  if (!mainWindow) return;
  contentProtected = !!on;
  mainWindow.setContentProtection(contentProtected);
  if (stickyWindow && !stickyWindow.isDestroyed())
    stickyWindow.setContentProtection(contentProtected);
  mainWindow.webContents.send("protection-state", contentProtected);
});

ipcMain.on("win-set-resizable", (_e, on) => {
  if (mainWindow) mainWindow.setResizable(!!on);
});

ipcMain.handle("win-get-size", () => {
  if (!mainWindow) return { w: 0, h: 0 };
  const [w, h] = mainWindow.getSize();
  return { w, h };
});

ipcMain.on("win-set-size", (_e, { w, h }) => applySize(w, h));

// ---------- Sticky note window ----------
function createStickyWindow() {
  if (stickyWindow && !stickyWindow.isDestroyed()) return stickyWindow;
  stickyWindow = new BrowserWindow({
    width: 320,
    height: 260,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loadRenderer(stickyWindow, "sticky.html");
  if (contentProtected) stickyWindow.setContentProtection(true);
  stickyWindow.on("closed", () => {
    stickyWindow = null;
  });
  return stickyWindow;
}

function showSticky(note) {
  currentStickyNoteId = note.id || null;
  const win = createStickyWindow();
  const send = () => win.webContents.send("sticky-data", note);
  if (win.webContents.isLoading())
    win.webContents.once("did-finish-load", send);
  else send();
  win.show();
  win.focus();
}

function updateStickyContent(note) {
  if (!stickyWindow || stickyWindow.isDestroyed() || !stickyWindow.isVisible())
    return;
  if (note.id && note.id === currentStickyNoteId) {
    stickyWindow.webContents.send("sticky-data", note);
  }
}

function toggleStickyVisibility() {
  if (!stickyWindow || stickyWindow.isDestroyed()) {
    if (mainWindow)
      mainWindow.webContents.send("hotkey-action", { action: "toggleSticky" });
    return;
  }
  if (stickyWindow.isVisible()) stickyWindow.hide();
  else {
    stickyWindow.show();
    stickyWindow.focus();
  }
}

// ---------- hotkey actions ----------
function applySize(w, h) {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  const wasResizable = mainWindow.isResizable();
  if (!wasResizable) mainWindow.setResizable(true);
  mainWindow.setMinimumSize(Math.min(380, w), Math.min(500, h));
  mainWindow.setSize(w, h);
  if (!wasResizable) mainWindow.setResizable(false);
}

function setSize(preset) {
  const { w, h } = settings.sizes[preset] || DEFAULT_SIZES[preset];
  applySize(w, h);
}

function toggleProtection() {
  if (!mainWindow) return;
  contentProtected = !contentProtected;
  mainWindow.setContentProtection(contentProtected);
  if (stickyWindow && !stickyWindow.isDestroyed())
    stickyWindow.setContentProtection(contentProtected);
  mainWindow.webContents.send("protection-state", contentProtected);
}

function toggleVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function moveWindow(dx, dy) {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  const [w, h] = mainWindow.getSize();
  const disp = screen.getDisplayMatching({
    x,
    y,
    width: w,
    height: h,
  }).workArea;
  const nx =
    dx !== 0 ? Math.max(disp.x, Math.min(x + dx, disp.x + disp.width - w)) : x;
  const ny =
    dy !== 0 ? Math.max(disp.y, Math.min(y + dy, disp.y + disp.height - h)) : y;
  mainWindow.setPosition(nx, ny);
}

function sendHelpRequest() {
  if (mainWindow)
    mainWindow.webContents.send("hotkey-action", { action: "helpRequest" });
}
function focusPanel(panel) {
  if (mainWindow)
    mainWindow.webContents.send("hotkey-action", {
      action: "focusPanel",
      panel,
    });
}
function navSticky(dir) {
  if (mainWindow)
    mainWindow.webContents.send("hotkey-action", { action: "navSticky", dir });
}

const hotkeyActions = {
  sizeMobile: () => setSize("mobile"),
  sizeTablet: () => setSize("tablet"),
  toggleShow: toggleVisibility,
  toggleProtection: toggleProtection,
  moveUp: () => moveWindow(0, -MOVE_STEP),
  moveDown: () => moveWindow(0, MOVE_STEP),
  moveLeft: () => moveWindow(-MOVE_STEP, 0),
  moveRight: () => moveWindow(MOVE_STEP, 0),
  helpRequest: sendHelpRequest,
  focusCaption: () => focusPanel("caption"),
  focusWeb: () => focusPanel("web"),
  focusChat: () => focusPanel("chat"),
  toggleSticky: toggleStickyVisibility,
  stickyPrev: () => navSticky(-1),
  stickyNext: () => navSticky(1),
  captureArea: () =>
    mainWindow &&
    mainWindow.webContents.send("hotkey-action", { action: "captureArea" }),
  opacityUp: () =>
    mainWindow &&
    mainWindow.webContents.send("hotkey-action", { action: "opacityUp" }),
  opacityDown: () =>
    mainWindow &&
    mainWindow.webContents.send("hotkey-action", { action: "opacityDown" }),
};

function registerHotkeys() {
  globalShortcut.unregisterAll();
  for (const [key, accel] of Object.entries(settings.hotkeys)) {
    if (!accel) continue;
    const fn = hotkeyActions[key];
    if (!fn) continue;
    try {
      globalShortcut.register(accel, fn);
    } catch (e) {
      console.error("hotkey register failed", key, accel, e.message);
    }
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  registerHotkeys();
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => {
  if (tcpServer) tcpServer.close();
  if (tcpClient) tcpClient.destroy();
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- settings IPC ----------
ipcMain.handle("suspend-hotkeys", () => {
  globalShortcut.unregisterAll();
});
ipcMain.handle("resume-hotkeys", () => {
  registerHotkeys();
});
ipcMain.handle("get-settings", () => settings);
ipcMain.handle("set-settings", (_e, next) => {
  if (next.hotkeys) settings.hotkeys = { ...settings.hotkeys, ...next.hotkeys };
  if (next.sizes) settings.sizes = { ...settings.sizes, ...next.sizes };
  if (Array.isArray(next.webpages)) settings.webpages = next.webpages;
  if (next.themeMode === 'light' || next.themeMode === 'dark') settings.themeMode = next.themeMode;
  saveSettings();
  registerHotkeys();
  return settings;
});

// ---------- File IPC ----------
ipcMain.handle("open-file-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Documents",
        extensions: ["pdf", "doc", "docx", "txt", "rtf", "md"],
      },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
});

ipcMain.handle("read-file", (_e, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    return {
      ok: true,
      name: path.basename(filePath),
      data: data.toString("base64"),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("save-file", async (_e, { name, data }) => {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: name });
  if (result.canceled || !result.filePath) return { ok: false };
  try {
    fs.writeFileSync(result.filePath, Buffer.from(data, "base64"));
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---------- Sticky window IPC ----------
ipcMain.handle("show-sticky", (_e, note) => {
  showSticky(note);
  return { ok: true };
});
ipcMain.handle("hide-sticky", () => {
  currentStickyNoteId = null;
  if (stickyWindow && !stickyWindow.isDestroyed()) stickyWindow.hide();
  return { ok: true };
});
ipcMain.on("close-sticky", () => {
  currentStickyNoteId = null;
  if (stickyWindow && !stickyWindow.isDestroyed()) stickyWindow.hide();
});
ipcMain.on("sticky-nav", (_e, dir) => navSticky(dir));
ipcMain.handle("update-sticky-content", (_e, note) => {
  updateStickyContent(note);
  return { ok: true };
});

// ---------- Screen capture IPC ----------
let captureOverlay = null;

ipcMain.handle("capture-area", async () => {
  if (captureOverlay && !captureOverlay.isDestroyed())
    return { ok: false, error: "already-capturing" };

  const winBounds = mainWindow ? mainWindow.getBounds() : null;
  const display = winBounds
    ? screen.getDisplayMatching(winBounds)
    : screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    },
  });
  const displayId = String(display.id);
  const src = sources.find((s) => s.display_id === displayId) || sources[0];
  if (!src) return { ok: false, error: "no-source" };
  const screenshot = src.thumbnail;

  return new Promise((resolve) => {
    captureOverlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width,
      height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreen: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    loadRenderer(captureOverlay, "capture.html");
    captureOverlay.once("ready-to-show", () => {
      captureOverlay.webContents.send("capture-init", { width, height, scale });
    });

    ipcMain.once("capture-done", (_e, rect) => {
      if (captureOverlay && !captureOverlay.isDestroyed())
        captureOverlay.close();
      captureOverlay = null;
      if (!rect) return resolve({ ok: false, cancelled: true });
      const cropped = screenshot.crop({
        x: Math.round(rect.x * scale),
        y: Math.round(rect.y * scale),
        width: Math.round(rect.w * scale),
        height: Math.round(rect.h * scale),
      });
      clipboard.writeImage(cropped);
      resolve({ ok: true, dataURL: cropped.toDataURL() });
    });

    captureOverlay.on("closed", () => {
      captureOverlay = null;
    });
  });
});

// ---------- TCP: Interviewer server ----------
ipcMain.handle("start-server", (_e, port) => {
  return new Promise((resolve, reject) => {
    if (tcpServer) {
      resolve({ ok: true, port });
      return;
    }
    tcpServer = net.createServer((socket) => {
      socket.setEncoding("utf8");
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            mainWindow.webContents.send("chat-message", JSON.parse(line));
          } catch {}
        }
      });
      socket.on("error", () => {});
      mainWindow.webContents.send("peer-status", { connected: true });
      socket.on("close", () =>
        mainWindow.webContents.send("peer-status", { connected: false }),
      );
      tcpServer._socket = socket;
    });
    tcpServer.on("error", (err) => reject(err.message));
    tcpServer.listen(port, () => resolve({ ok: true, port }));
  });
});

// ---------- TCP: Support client ----------
ipcMain.handle("connect", (_e, { host, port }) => {
  return new Promise((resolve, reject) => {
    if (tcpClient) {
      tcpClient.destroy();
      tcpClient = null;
    }
    tcpClient = net.createConnection({ host, port }, () => {
      mainWindow.webContents.send("peer-status", { connected: true });
      resolve({ ok: true });
    });
    tcpClient.setEncoding("utf8");
    let buffer = "";
    tcpClient.on("data", (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          mainWindow.webContents.send("chat-message", JSON.parse(line));
        } catch {}
      }
    });
    tcpClient.on("error", (err) => {
      mainWindow.webContents.send("peer-status", {
        connected: false,
        error: err.message,
      });
      reject(err.message);
    });
    tcpClient.on("close", () =>
      mainWindow.webContents.send("peer-status", { connected: false }),
    );
  });
});

ipcMain.handle("disconnect", () => {
  if (tcpClient) {
    tcpClient.destroy();
    tcpClient = null;
  }
  return { ok: true };
});

ipcMain.handle("send-message", (_e, payload) => {
  const line = JSON.stringify(payload) + "\n";
  if (tcpClient && !tcpClient.destroyed) {
    tcpClient.write(line);
    return { ok: true };
  }
  if (tcpServer && tcpServer._socket && !tcpServer._socket.destroyed) {
    tcpServer._socket.write(line);
    return { ok: true };
  }
  return { ok: false, error: "Not connected" };
});
