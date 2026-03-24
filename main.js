const { app, BrowserWindow, ipcMain, globalShortcut, screen, dialog, desktopCapturer, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { execSync, spawn } = require('child_process');

let mainWindow;
let stickyWindow = null;
let tcpServer = null;
let tcpClient = null;

// ---------- caption state ----------
let captionProc = null;
let captionActive = false;
let audioRingBuffer = Buffer.alloc(0);
let captionPipeline = null;
const SAMPLE_RATE = 16000;
const CHUNK_BYTES = SAMPLE_RATE * 2 * 4;   // 4 seconds of 16-bit mono PCM
const STRIDE_BYTES = SAMPLE_RATE * 2 * 1;  // 1-second overlap to avoid word boundary cuts

const MOVE_STEP = 40;
const SIZES = {
  mobile: { w: 420, h: 780 },
  tablet: { w: 900, h: 700 }
};

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const defaultSettings = {
  hotkeys: {
    sizeMobile:   'CommandOrControl+Alt+1',
    sizeTablet:   'CommandOrControl+Alt+2',
    toggleShow:   'CommandOrControl+Alt+H',
    moveUp:       'CommandOrControl+Alt+Up',
    moveDown:     'CommandOrControl+Alt+Down',
    moveLeft:     'CommandOrControl+Alt+Left',
    moveRight:    'CommandOrControl+Alt+Right',
    helpRequest:  'CommandOrControl+Alt+/',
    focusCaption: 'CommandOrControl+Alt+4',
    focusWeb:     'CommandOrControl+Alt+5',
    focusChat:    'CommandOrControl+Alt+6',
    toggleSticky: 'CommandOrControl+Alt+S',
    stickyPrev:   'CommandOrControl+Alt+[',
    stickyNext:   'CommandOrControl+Alt+]',
    captureArea:  'CommandOrControl+Alt+C'
  },
  webpages: [
    'https://example.com',
    'https://developer.mozilla.org'
  ]
};

let settings = loadSettings();

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      hotkeys: { ...defaultSettings.hotkeys, ...(parsed.hotkeys || {}) },
      webpages: Array.isArray(parsed.webpages) ? parsed.webpages : defaultSettings.webpages
    };
  } catch {
    return JSON.parse(JSON.stringify(defaultSettings));
  }
}

function saveSettings() {
  try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)); }
  catch (e) { console.error('save settings failed', e); }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  mainWindow.loadFile('renderer/index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (stickyWindow && !stickyWindow.isDestroyed()) stickyWindow.close();
  });
}

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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  stickyWindow.loadFile('renderer/sticky.html');

  stickyWindow.on('closed', () => { stickyWindow = null; });
  return stickyWindow;
}

function showSticky(note) {
  const win = createStickyWindow();
  const send = () => win.webContents.send('sticky-data', note);
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
  win.show();
  win.focus();
}

function toggleStickyVisibility() {
  if (!stickyWindow || stickyWindow.isDestroyed()) {
    // Ask renderer for current notes so we can open with something useful
    if (mainWindow) mainWindow.webContents.send('hotkey-action', { action: 'toggleSticky' });
    return;
  }
  if (stickyWindow.isVisible()) stickyWindow.hide();
  else { stickyWindow.show(); stickyWindow.focus(); }
}

// ---------- hotkey actions ----------
function setSize(preset) {
  if (!mainWindow) return;
  const { w, h } = SIZES[preset];
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  mainWindow.setSize(w, h);
}

function toggleVisibility() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else { mainWindow.show(); mainWindow.focus(); }
}

function moveWindow(dx, dy) {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  const [w, h] = mainWindow.getSize();
  const disp = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea;
  const nx = dx !== 0 ? Math.max(disp.x, Math.min(x + dx, disp.x + disp.width - w)) : x;
  const ny = dy !== 0 ? Math.max(disp.y, Math.min(y + dy, disp.y + disp.height - h)) : y;
  mainWindow.setPosition(nx, ny);
}

function sendHelpRequest() {
  if (!mainWindow) return;
  mainWindow.webContents.send('hotkey-action', { action: 'helpRequest' });
}

function focusPanel(panel) {
  if (!mainWindow) return;
  mainWindow.webContents.send('hotkey-action', { action: 'focusPanel', panel });
}

const hotkeyActions = {
  sizeMobile:   () => setSize('mobile'),
  sizeTablet:   () => setSize('tablet'),
  toggleShow:   toggleVisibility,
  moveUp:       () => moveWindow(0, -MOVE_STEP),
  moveDown:     () => moveWindow(0,  MOVE_STEP),
  moveLeft:     () => moveWindow(-MOVE_STEP, 0),
  moveRight:    () => moveWindow( MOVE_STEP, 0),
  helpRequest:  sendHelpRequest,
  focusCaption: () => focusPanel('caption'),
  focusWeb:     () => focusPanel('web'),
  focusChat:    () => focusPanel('chat'),
  toggleSticky: toggleStickyVisibility,
  stickyPrev:   () => navSticky(-1),
  stickyNext:   () => navSticky(1),
  captureArea:  () => mainWindow && mainWindow.webContents.send('hotkey-action', { action: 'captureArea' })
};

function navSticky(dir) {
  if (!mainWindow) return;
  mainWindow.webContents.send('hotkey-action', { action: 'navSticky', dir });
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  for (const [key, accel] of Object.entries(settings.hotkeys)) {
    if (!accel) continue;
    const fn = hotkeyActions[key];
    if (!fn) continue;
    try { globalShortcut.register(accel, fn); }
    catch (e) { console.error('hotkey register failed', key, accel, e.message); }
  }
}

// ---------- caption helpers ----------
const isWin = process.platform === 'win32';

function findAudioSource() {
  if (isWin) {
    // On Windows, ffmpeg's dshow "virtual-audio-capturer" or WASAPI loopback is used.
    // We don't need to discover a device name — ffmpeg uses the default loopback.
    return 'wasapi-loopback';
  }
  // Linux: find PulseAudio monitor source
  try {
    const sink = execSync('pactl get-default-sink', { encoding: 'utf8' }).trim();
    if (sink) return `${sink}.monitor`;
  } catch {}
  try {
    const list = execSync('pactl list short sources', { encoding: 'utf8' });
    const line = list.split('\n').find(l => l.includes('.monitor'));
    if (line) return line.split('\t')[1];
  } catch {}
  return null;
}

function spawnAudioCapture(source) {
  if (isWin) {
    // Windows: use ffmpeg with WASAPI loopback (captures system audio output)
    // Requires ffmpeg to be installed and in PATH
    return spawn('ffmpeg', [
      '-f', 'dshow',
      '-i', 'audio=virtual-audio-capturer',
      '-ar', String(SAMPLE_RATE),
      '-ac', '1',
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
  }
  // Linux: use parec directly
  return spawn('parec', [
    '--device', source,
    '--rate', String(SAMPLE_RATE),
    '--channels', '1',
    '--format', 's16le',
    '--raw'
  ]);
}

function pcmToFloat32(buf) {
  const out = new Float32Array(buf.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = buf.readInt16LE(i * 2) / 32768.0;
  return out;
}

async function ensurePipeline() {
  if (captionPipeline) return captionPipeline;
  const { pipeline } = await import('@xenova/transformers');
  const modelPath = path.join(app.getPath('userData'), 'models', 'whisper-base');
  let modelId = 'openai/whisper-base';
  // Use local model if it exists
  if (fs.existsSync(path.join(modelPath, 'config.json'))) {
    modelId = modelPath;
  }
  captionPipeline = await pipeline('automatic-speech-recognition', modelId);
  return captionPipeline;
}

let captionProcessing = false; // guard against overlapping inference

// ---------- caption IPC ----------
ipcMain.handle('start-caption', async () => {
  if (captionActive) return { ok: true };

  const src = findAudioSource();
  if (!src) return { ok: false, error: 'no-audio-source' };

  let asr;
  try {
    mainWindow.webContents.send('caption-segment', { type: 'status', text: 'Loading Whisper model...' });
    asr = await ensurePipeline();
  } catch (e) { return { ok: false, error: 'pipeline-init-failed', detail: e.message }; }

  captionActive = true;
  captionProcessing = false;
  audioRingBuffer = Buffer.alloc(0);

  captionProc = spawnAudioCapture(src);

  captionProc.stdout.on('data', async (chunk) => {
    if (!captionActive) return;
    audioRingBuffer = Buffer.concat([audioRingBuffer, chunk]);
    if (audioRingBuffer.length < CHUNK_BYTES || captionProcessing) return;

    captionProcessing = true;
    const toProcess = audioRingBuffer.slice(0, CHUNK_BYTES);
    audioRingBuffer = audioRingBuffer.slice(CHUNK_BYTES - STRIDE_BYTES);

    try {
      const result = await asr(pcmToFloat32(toProcess), { sampling_rate: SAMPLE_RATE });
      const text = (result.text || '').trim();
      if (!text || !mainWindow || mainWindow.isDestroyed()) { captionProcessing = false; return; }
      const stable = text.length >= 80 || /[.?!]$/.test(text);
      mainWindow.webContents.send('caption-segment', { type: stable ? 'stable' : 'interim', text });
    } catch (e) { console.error('caption inference error', e); }
    captionProcessing = false;
  });

  captionProc.on('error', (err) => {
    captionActive = false;
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('caption-segment', { type: 'error', error: err.message });
  });

  return { ok: true };
});

ipcMain.handle('stop-caption', () => {
  captionActive = false;
  if (captionProc) { captionProc.kill(); captionProc = null; }
  audioRingBuffer = Buffer.alloc(0);
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();
  registerHotkeys();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (tcpServer) tcpServer.close();
  if (tcpClient) tcpClient.destroy();
  if (captionProc) { captionProc.kill(); captionProc = null; }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- hotkey suspend/resume for settings ----------
ipcMain.handle('suspend-hotkeys', () => { globalShortcut.unregisterAll(); });
ipcMain.handle('resume-hotkeys', () => { registerHotkeys(); });

// ---------- settings IPC ----------
ipcMain.handle('get-settings', () => settings);

ipcMain.handle('set-settings', (_e, next) => {
  if (next.hotkeys) settings.hotkeys = { ...settings.hotkeys, ...next.hotkeys };
  if (Array.isArray(next.webpages)) settings.webpages = next.webpages;
  saveSettings();
  registerHotkeys();
  return settings;
});

// ---------- File dialog ----------
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'md'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
});

// ---------- Sticky window IPC ----------
ipcMain.handle('show-sticky', (_e, note) => {
  showSticky(note);
  return { ok: true };
});

ipcMain.handle('hide-sticky', () => {
  if (stickyWindow && !stickyWindow.isDestroyed()) stickyWindow.hide();
  return { ok: true };
});

ipcMain.on('close-sticky', () => {
  if (stickyWindow && !stickyWindow.isDestroyed()) stickyWindow.hide();
});

ipcMain.on('sticky-nav', (_e, dir) => navSticky(dir));

// ---------- File transfer IPC ----------
ipcMain.handle('read-file', (_e, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    return { ok: true, name: path.basename(filePath), data: data.toString('base64') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('save-file', async (_e, { name, data }) => {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath: name });
  if (result.canceled || !result.filePath) return { ok: false };
  try {
    fs.writeFileSync(result.filePath, Buffer.from(data, 'base64'));
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---------- Screen capture IPC ----------
let captureOverlay = null;

ipcMain.handle('capture-area', async () => {
  if (captureOverlay && !captureOverlay.isDestroyed()) return { ok: false, error: 'already-capturing' };

  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) }
  });
  if (!sources.length) return { ok: false, error: 'no-source' };
  const screenshot = sources[0].thumbnail;

  return new Promise((resolve) => {
    captureOverlay = new BrowserWindow({
      x: display.bounds.x, y: display.bounds.y, width, height,
      frame: false, transparent: true, alwaysOnTop: true,
      skipTaskbar: true, resizable: false, movable: false, fullscreen: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false
      }
    });
    captureOverlay.loadFile('renderer/capture.html');
    captureOverlay.once('ready-to-show', () => {
      captureOverlay.webContents.send('capture-init', {
        dataURL: screenshot.toDataURL(), width, height, scale
      });
    });

    ipcMain.once('capture-done', (_e, rect) => {
      if (captureOverlay && !captureOverlay.isDestroyed()) captureOverlay.close();
      captureOverlay = null;
      if (!rect) return resolve({ ok: false, cancelled: true });
      const cropped = screenshot.crop({
        x: Math.round(rect.x * scale), y: Math.round(rect.y * scale),
        width: Math.round(rect.w * scale), height: Math.round(rect.h * scale)
      });
      clipboard.writeImage(cropped);
      resolve({ ok: true, dataURL: cropped.toDataURL() });
    });

    captureOverlay.on('closed', () => { captureOverlay = null; });
  });
});

// ---------- Interviewer: start TCP server ----------
ipcMain.handle('start-server', (event, port) => {
  return new Promise((resolve, reject) => {
    if (tcpServer) {
      resolve({ ok: true, port });
      return;
    }
    tcpServer = net.createServer((socket) => {
      socket.setEncoding('utf8');
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            mainWindow.webContents.send('chat-message', msg);
          } catch (e) { /* ignore bad line */ }
        }
      });
      socket.on('error', () => {});
      mainWindow.webContents.send('peer-status', { connected: true });
      socket.on('close', () => {
        mainWindow.webContents.send('peer-status', { connected: false });
      });
      tcpServer._socket = socket;
    });
    tcpServer.on('error', (err) => reject(err.message));
    tcpServer.listen(port, () => resolve({ ok: true, port }));
  });
});

// ---------- Support: connect to interviewer ----------
ipcMain.handle('connect', (event, { host, port }) => {
  return new Promise((resolve, reject) => {
    if (tcpClient) {
      tcpClient.destroy();
      tcpClient = null;
    }
    tcpClient = net.createConnection({ host, port }, () => {
      mainWindow.webContents.send('peer-status', { connected: true });
      resolve({ ok: true });
    });
    tcpClient.setEncoding('utf8');
    let buffer = '';
    tcpClient.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          mainWindow.webContents.send('chat-message', msg);
        } catch (e) { /* ignore */ }
      }
    });
    tcpClient.on('error', (err) => {
      mainWindow.webContents.send('peer-status', { connected: false, error: err.message });
      reject(err.message);
    });
    tcpClient.on('close', () => {
      mainWindow.webContents.send('peer-status', { connected: false });
    });
  });
});

ipcMain.handle('disconnect', () => {
  if (tcpClient) {
    tcpClient.destroy();
    tcpClient = null;
  }
  return { ok: true };
});

// ---------- Send message ----------
ipcMain.handle('send-message', (event, payload) => {
  const line = JSON.stringify(payload) + '\n';
  if (tcpClient && !tcpClient.destroyed) {
    tcpClient.write(line);
    return { ok: true };
  }
  if (tcpServer && tcpServer._socket && !tcpServer._socket.destroyed) {
    tcpServer._socket.write(line);
    return { ok: true };
  }
  return { ok: false, error: 'Not connected' };
});
