const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startServer: (port) => ipcRenderer.invoke('start-server', port),
  connect: (host, port) => ipcRenderer.invoke('connect', { host, port }),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  sendMessage: (payload) => ipcRenderer.invoke('send-message', payload),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s) => ipcRenderer.invoke('set-settings', s),
  suspendHotkeys: () => ipcRenderer.invoke('suspend-hotkeys'),
  resumeHotkeys: () => ipcRenderer.invoke('resume-hotkeys'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  saveFile: (f) => ipcRenderer.invoke('save-file', f),
  captureArea: () => ipcRenderer.invoke('capture-area'),
  showSticky: (note) => ipcRenderer.invoke('show-sticky', note),
  hideSticky: () => ipcRenderer.invoke('hide-sticky'),
  closeSticky: () => ipcRenderer.send('close-sticky'),
  stickyNav: (dir) => ipcRenderer.send('sticky-nav', dir),
  captureDone: (rect) => ipcRenderer.send('capture-done', rect),
  onChatMessage: (cb) => ipcRenderer.on('chat-message', (_e, msg) => cb(msg)),
  onPeerStatus: (cb) => ipcRenderer.on('peer-status', (_e, s) => cb(s)),
  onHotkeyAction: (cb) => ipcRenderer.on('hotkey-action', (_e, a) => cb(a)),
  onStickyData: (cb) => ipcRenderer.on('sticky-data', (_e, d) => cb(d)),
  onCaptureInit: (cb) => ipcRenderer.on('capture-init', (_e, d) => cb(d))
});
