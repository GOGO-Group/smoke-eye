"use strict";
// Electron utilityProcess entry: runs the native Win32 backend in its OWN
// process so blocking calls (EnumWindows sweeps, the up-to-5s injection wait in
// setCaptureProtect) never freeze the main process / UI. Request/response by id
// over parentPort, mirroring the old bridge.py stdio protocol.
const { dispatch } = require("./dispatch");

process.parentPort.on("message", (e) => {
  const { id, cmd } = e.data;
  let res;
  try {
    res = { id, ok: true, result: dispatch(cmd) };
  } catch (err) {
    res = { id, ok: false, error: String((err && err.message) || err) };
  }
  process.parentPort.postMessage(res);
});
