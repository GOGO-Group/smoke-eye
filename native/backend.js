"use strict";
// Supervises the native Win32 backend running in an Electron utilityProcess.
// Keeps it off the main thread (no UI freeze) and respawns it automatically if
// it dies — e.g. a faulted injection stub crashing the worker — with capped
// exponential backoff. Request/response is keyed by id, the contract bridge.py
// used over stdio.
const path = require("path");
const { utilityProcess } = require("electron");

const WORKER = path.join(__dirname, "worker.js");
const HEALTHY_MS = 10000;     // uptime past which a start counts as stable
const MAX_BACKOFF_MS = 5000;

let proc = null;
let nextId = 1;
let quitting = false;         // set during app shutdown so we don't respawn
let respawnTimer = null;
let attempts = 0;
let spawnedAt = 0;
const pending = new Map();

function start() {
  quitting = false;
  spawnedAt = Date.now();     // provisional; refined on the "spawn" event
  proc = utilityProcess.fork(WORKER);
  proc.on("spawn", () => { spawnedAt = Date.now(); });
  proc.on("message", (msg) => {
    const cb = pending.get(msg.id);
    if (cb) { pending.delete(msg.id); cb(msg); }
  });
  proc.on("exit", (code) => {
    proc = null;
    for (const [id, cb] of pending) cb({ id, ok: false, error: "backend exited" });
    pending.clear();
    if (quitting) return;                              // intentional shutdown
    if (Date.now() - spawnedAt > HEALTHY_MS) attempts = 0;  // had been stable
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempts);
    attempts++;
    console.error(`[backend] exited (code ${code}); respawning in ${delay}ms (attempt ${attempts})`);
    respawnTimer = setTimeout(() => { respawnTimer = null; start(); }, delay);
  });
}

function call(cmd) {
  return new Promise((resolve, reject) => {
    if (!proc) return reject(new Error("backend down"));
    const id = nextId++;
    pending.set(id, (msg) => (msg.ok ? resolve(msg.result) : reject(new Error(msg.error))));
    proc.postMessage({ id, cmd });
  });
}

function stop() {
  quitting = true;
  if (respawnTimer) { clearTimeout(respawnTimer); respawnTimer = null; }
  if (proc) { proc.kill(); proc = null; }
}

const pid = () => (proc ? proc.pid : null);

module.exports = { start, call, stop, pid };
