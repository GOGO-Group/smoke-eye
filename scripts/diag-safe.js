"use strict";
// Diagnose why "Safe" (capture protection) does or doesn't apply to a window.
// Run with the 64-bit node from the project root:
//
//   node scripts/diag-safe.js            # hover the target; it picks after 4s
//   node scripts/diag-safe.js --pid 1234 # target a process's main window
//   node scripts/diag-safe.js --hwnd 987654
//
// Prints the target's identity, bitness, flags and the exact result of the
// capture-protection attempt (the message the dial would toast). Share the
// output. Nothing is left changed except the target's P flag if it succeeds.
const wc = require("../native/windowctl");
const { listProcesses } = require("../native/processes");

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

function nameOf(pid) {
  const p = listProcesses().find((x) => x.pid === pid);
  return p ? p.name : "(unknown)";
}

function report(hwnd, pid) {
  if (!wc.isWindow(hwnd)) {
    console.log("No valid window for that target.");
    return;
  }
  const bits = wc.probeBits(pid);
  console.log("── target ──────────────────────────────");
  console.log("pid       :", pid, `(${nameOf(pid)})`);
  console.log("hwnd      :", wc._addr(hwnd));
  console.log("class     :", wc.windowClass(hwnd));
  console.log("bitness   :", bits == null ? "unknown (can't open)" : `${bits}-bit`);
  console.log("this build:", process.arch === "x64" ? "64-bit" : "32-bit");
  console.log("flags now :", JSON.stringify(wc.windowFlags(hwnd)));
  console.log("── applying capture protection (P) ─────");
  const [ok, msg] = wc.setCaptureProtect(hwnd, true);
  console.log("result    :", ok ? "OK" : "FAILED");
  console.log("message   :", msg);
  console.log("flags after:", JSON.stringify(wc.windowFlags(hwnd)));
  if (ok && !wc.windowFlags(hwnd).includes("P"))
    console.log(
      "NOTE: call reported success but P is not readable back — the affinity\n" +
        "      did not stick on this HWND (likely the visible surface is a\n" +
        "      different/child window than the one targeted).",
    );
}

const pidArg = opt("--pid");
const hwndArg = opt("--hwnd");

if (hwndArg) {
  const hwnd = BigInt(hwndArg);
  report(hwnd, wc.ownerPid(hwnd));
} else if (pidArg) {
  const pid = Number(pidArg);
  const hwnd = wc.mainWindow(pid);
  if (!hwnd) return console.log(`No top-level window found for pid ${pid}.`);
  report(hwnd, pid);
} else {
  console.log("Hover the mouse over the VMware window — picking in 4 seconds...");
  setTimeout(() => {
    const { x, y } = wc.cursorPos();
    const r = wc.pidFromPoint(x, y);
    if (!r.hwnd) return console.log("No window under the cursor.");
    console.log(`picked at (${x}, ${y}) title="${r.title}"`);
    report(r.hwnd, r.pid);
  }, 4000);
}
