"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  bridge: (cmd) => ipcRenderer.invoke("bridge", cmd),
  cursorPos: () => ipcRenderer.invoke("cursorPos"),
  winPos: () => ipcRenderer.invoke("winPos"),
  ourHwnd: () => ipcRenderer.invoke("ourHwnd"),
  setWinPos: (x, y) => ipcRenderer.send("setWinPos", { x, y }),
  resize: (w, h) => ipcRenderer.send("resize", { w, h }),
  ignoreMouse: (ignore) => ipcRenderer.send("ignoreMouse", ignore),
  raise: () => ipcRenderer.send("raise"),
  openSettings: () => ipcRenderer.send("openSettings"),
  onHotkey: (cb) => ipcRenderer.on("hotkey", (_e, action) => cb(action)),
  quit: () => ipcRenderer.send("quit"),
});
