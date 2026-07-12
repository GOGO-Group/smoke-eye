"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// Settings window talks only to the main process to tweak the controller.
contextBridge.exposeInMainWorld("settings", {
  get: () => ipcRenderer.invoke("settings:get"),
  setProtect: (v) => ipcRenderer.send("settings:setProtect", v),
  setTop: (v) => ipcRenderer.send("settings:setTop", v),
  setOpacity: (v) => ipcRenderer.send("settings:setOpacity", v),
  setHotkey: (action, accel) => ipcRenderer.invoke("settings:setHotkey", { action, accel }),
  close: () => ipcRenderer.send("settings:close"),
  quit: () => ipcRenderer.send("quit"),
});
