"use strict";
// In-process replacement for bridge.py: same {cmd,...} -> result contract the
// renderer already speaks. Handles cross IPC as Numbers (addresses); windowctl
// normalizes Number/BigInt internally.
const wc = require("./windowctl");
const { listProcesses } = require("./processes");

const num = (h) => (h == null ? null : Number(h));

function setFlag(req) {
  const { hwnd, flag } = req;
  const value = req.value;
  if (!wc.isWindow(hwnd)) return { ok: false, msg: "window gone", flags: "" };
  let r;
  if (flag === "top") r = wc.setTopmost(hwnd, !!value);
  else if (flag === "through") r = wc.setClickThrough(hwnd, !!value);
  else if (flag === "opacity") r = wc.setAlpha(hwnd, parseInt(value, 10));
  else if (flag === "safe") {
    wc.setTaskbarHidden(hwnd, !!value);                 // H first
    r = wc.setCaptureProtect(hwnd, !!value);            // P last
  } else if (flag === "restore") {
    wc.setTopmost(hwnd, false); wc.setCaptureProtect(hwnd, false);
    wc.setTaskbarHidden(hwnd, false); wc.setClickThrough(hwnd, false);
    wc.setAlpha(hwnd, 255);
    r = [true, "restored"];
  } else r = [false, `unknown flag ${flag}`];
  return { ok: r[0], msg: r[1], flags: wc.windowFlags(hwnd) };
}

function dispatch(req) {
  const cmd = req.cmd;
  if (cmd === "pick" || cmd === "pick_cursor") {
    const { x, y } = cmd === "pick_cursor" ? wc.cursorPos() : { x: req.x, y: req.y };
    const r = wc.pidFromPoint(x, y);
    if (r.hwnd && num(r.hwnd) === req.exclude) return { pid: null, hwnd: null, title: "" };
    return { pid: r.pid, hwnd: num(r.hwnd), title: r.title };
  }
  if (cmd === "main_window") return { hwnd: num(wc.mainWindow(req.pid)) };
  if (cmd === "flags") return { flags: wc.windowFlags(req.hwnd) };
  if (cmd === "alpha") return { alpha: wc.getAlpha(req.hwnd) };
  if (cmd === "is_window") return { alive: wc.isWindow(req.hwnd) };
  if (cmd === "list") {
    const needle = (req.needle || "").toLowerCase();
    const fmap = wc.flagsMap();
    const procs = listProcesses()
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || String(p.pid).includes(needle))
      .map((p) => ({ pid: p.pid, name: p.name, flags: fmap[p.pid] || "" }));
    return { procs };
  }
  if (cmd === "set") return setFlag(req);
  throw new Error(`unknown cmd ${cmd}`);
}

module.exports = { dispatch };
