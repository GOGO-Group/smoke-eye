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
  showSticky: (note) => ipcRenderer.invoke('show-sticky', note),
  hideSticky: () => ipcRenderer.invoke('hide-sticky'),
  closeSticky: () => ipcRenderer.send('close-sticky'),
  setWindowSize: (w, h) => ipcRenderer.invoke('set-window-size', { w, h }),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  saveFileDialog: (name, data) => ipcRenderer.invoke('save-file-dialog', { name, data }),
  onChatMessage: (cb) => ipcRenderer.on('chat-message', (_e, msg) => cb(msg)),
  onPeerStatus: (cb) => ipcRenderer.on('peer-status', (_e, s) => cb(s)),
  onHotkeyAction: (cb) => ipcRenderer.on('hotkey-action', (_e, a) => cb(a)),
  onStickyData: (cb) => ipcRenderer.on('sticky-data', (_e, d) => cb(d))
});
