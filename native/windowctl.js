"use strict";
// koffi port of windowctl.py — Win32 window control with no Python.
//
// Handles (HWND/HANDLE) are BigInt throughout: koffi returns `void*` as BigInt
// and accepts BigInt back for `void*` params (verified). Out-params are passed
// as a 1-element array koffi writes into. Each flag op returns {ok, msg} to
// match the Python contract the renderer already expects.

const koffi = require("koffi");

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");

// --- structs ---------------------------------------------------------------
const POINT = koffi.struct("POINT", { x: "int32", y: "int32" });

// --- user32 ----------------------------------------------------------------
const WNDENUMPROC = koffi.proto("bool __stdcall _wndenum(void *hwnd, intptr_t lp)");

const GetCursorPos = user32.func("bool __stdcall GetCursorPos(_Out_ POINT *p)");
const WindowFromPoint = user32.func("void* __stdcall WindowFromPoint(POINT p)");
const GetAncestor = user32.func("void* __stdcall GetAncestor(void *h, uint32 flags)");
const GetWindow = user32.func("void* __stdcall GetWindow(void *h, uint32 cmd)");
const IsWindow = user32.func("bool __stdcall IsWindow(void *h)");
const IsWindowVisible = user32.func("bool __stdcall IsWindowVisible(void *h)");
const EnumWindows = user32.func("bool __stdcall EnumWindows(void *cb, intptr_t lp)");
const GetWindowThreadProcessId = user32.func(
  "uint32 __stdcall GetWindowThreadProcessId(void *h, _Out_ uint32 *pid)");
const GetWindowTextLengthW = user32.func("int __stdcall GetWindowTextLengthW(void *h)");
const GetWindowTextW = user32.func("int __stdcall GetWindowTextW(void *h, _Out_ uint16 *b, int n)");
const GetClassNameW = user32.func("int __stdcall GetClassNameW(void *h, _Out_ uint16 *b, int n)");
const ShowWindow = user32.func("bool __stdcall ShowWindow(void *h, int cmd)");
const SetWindowPos = user32.func(
  "bool __stdcall SetWindowPos(void *h, intptr_t after, int x, int y, int cx, int cy, uint32 flags)");
const GetWindowLongPtrW = user32.func("intptr_t __stdcall GetWindowLongPtrW(void *h, int i)");
const SetWindowLongPtrW = user32.func("intptr_t __stdcall SetWindowLongPtrW(void *h, int i, intptr_t v)");
const SetWindowDisplayAffinity = user32.func(
  "bool __stdcall SetWindowDisplayAffinity(void *h, uint32 aff)");
const GetWindowDisplayAffinity = user32.func(
  "bool __stdcall GetWindowDisplayAffinity(void *h, _Out_ uint32 *aff)");
const SetLayeredWindowAttributes = user32.func(
  "bool __stdcall SetLayeredWindowAttributes(void *h, uint32 key, uint8 a, uint32 flags)");
const GetLayeredWindowAttributes = user32.func(
  "bool __stdcall GetLayeredWindowAttributes(void *h, _Out_ uint32 *key, _Out_ uint8 *a, _Out_ uint32 *flags)");

// --- kernel32 (injection + last error) -------------------------------------
const GetLastError = kernel32.func("uint32 __stdcall GetLastError()");
const GetModuleHandleA = kernel32.func("void* __stdcall GetModuleHandleA(str name)");
const GetProcAddress = kernel32.func("void* __stdcall GetProcAddress(void *mod, str name)");
const OpenProcess = kernel32.func("void* __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)");
const CloseHandle = kernel32.func("bool __stdcall CloseHandle(void *h)");
const IsWow64Process = kernel32.func("bool __stdcall IsWow64Process(void *h, _Out_ bool *wow)");
const VirtualAllocEx = kernel32.func(
  "void* __stdcall VirtualAllocEx(void *h, void *addr, size_t size, uint32 type, uint32 protect)");
const VirtualFreeEx = kernel32.func(
  "bool __stdcall VirtualFreeEx(void *h, void *addr, size_t size, uint32 type)");
const WriteProcessMemory = kernel32.func(
  "bool __stdcall WriteProcessMemory(void *h, void *addr, void *buf, size_t n, _Out_ size_t *written)");
const CreateRemoteThread = kernel32.func(
  "void* __stdcall CreateRemoteThread(void *h, void *attr, size_t stack, void *start, void *param, uint32 flags, _Out_ uint32 *tid)");
const WaitForSingleObject = kernel32.func("uint32 __stdcall WaitForSingleObject(void *h, uint32 ms)");
const GetExitCodeThread = kernel32.func("bool __stdcall GetExitCodeThread(void *h, _Out_ uint32 *code)");

// --- constants -------------------------------------------------------------
const GW_OWNER = 4, GA_ROOT = 2;
const SW_HIDE = 0, SW_SHOW = 5, SW_RESTORE = 9;
const HWND_TOPMOST = -1, HWND_NOTOPMOST = -2;
const SWP_NOSIZE = 0x0001, SWP_NOMOVE = 0x0002, SWP_NOACTIVATE = 0x0010;
const GWL_EXSTYLE = -20;
const WS_EX_TOPMOST = 0x00000008, WS_EX_TRANSPARENT = 0x00000020;
const WS_EX_TOOLWINDOW = 0x00000080, WS_EX_LAYERED = 0x00080000;
const WS_EX_APPWINDOW = 0x00040000;
const LWA_ALPHA = 0x02;
const WDA_NONE = 0x00, WDA_EXCLUDEFROMCAPTURE = 0x11;

const PROCESS_INJECT_ACCESS = 0x0002 | 0x0400 | 0x0008 | 0x0020 | 0x0010;
const MEM_COMMIT = 0x1000, MEM_RESERVE = 0x2000, MEM_RELEASE = 0x8000;
const PAGE_EXECUTE_READWRITE = 0x40;

const NO_INJECT_CLASSES = new Set(["ConsoleWindowClass", "PseudoConsoleWindow"]);

// Address of SetWindowDisplayAffinity in *our* user32. user32 is a KnownDLL, so
// it maps at the same base in every process this boot -> valid in the target.
const SWDA_ADDR = GetProcAddress(GetModuleHandleA("user32.dll"), "SetWindowDisplayAffinity");
const OUR_BITS = process.arch === "x64" ? 64 : 32;

// --- helpers ---------------------------------------------------------------
const H = (h) => (typeof h === "bigint" ? h : BigInt(h || 0)); // normalize handle
const isNull = (p) => p === null || p === undefined || p === 0n || p === 0;

function wtext(getLen, getText, h) {
  const n = getLen(h);
  if (n <= 0) return "";
  const buf = Buffer.alloc((n + 1) * 2);
  const len = getText(h, buf, n + 1);
  return buf.toString("utf16le", 0, len * 2);
}

// --- discovery -------------------------------------------------------------
function cursorPos() {
  const p = {};
  GetCursorPos(p);
  return { x: p.x, y: p.y };
}

function pidFromPoint(x, y) {
  const h = WindowFromPoint({ x: Math.trunc(x), y: Math.trunc(y) });
  if (isNull(h)) return { pid: null, hwnd: null, title: "" };
  const root = GetAncestor(h, GA_ROOT) || h;
  const pid = [0];
  GetWindowThreadProcessId(root, pid);
  return { pid: pid[0], hwnd: root, title: wtext(GetWindowTextLengthW, GetWindowTextW, root) };
}

function isWindow(h) { return !isNull(h) && !!IsWindow(H(h)); }

function windowClass(h) {
  const buf = Buffer.alloc(256 * 2);
  const len = GetClassNameW(H(h), buf, 256);
  return buf.toString("utf16le", 0, len * 2);
}

function ownerPid(h) {
  if (isNull(h)) return null;
  const pid = [0];
  GetWindowThreadProcessId(H(h), pid);
  return pid[0] || null;
}

// Enumerate top-level windows, calling visit(hwnd, pid, titleLen) per window.
function enumTopLevel(visit) {
  const cb = koffi.register((hwnd, _lp) => {
    const pid = [0];
    GetWindowThreadProcessId(hwnd, pid);
    visit(hwnd, pid[0]);
    return true;
  }, koffi.pointer(WNDENUMPROC));
  try { EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
}

function getWindowsForPid(pid) {
  const out = [];
  enumTopLevel((hwnd, owner) => {
    if (owner !== pid) return;
    if (!IsWindowVisible(hwnd)) return;
    if (!isNull(GetWindow(hwnd, GW_OWNER))) return;     // skip owned popups
    out.push([hwnd, wtext(GetWindowTextLengthW, GetWindowTextW, hwnd)]);
  });
  return out;
}

function mainWindow(pid) {
  const wins = getWindowsForPid(pid);
  if (!wins.length) return null;
  const titled = wins.filter((w) => w[1].trim());
  return (titled.length ? titled : wins)[0][0];
}

// One EnumWindows pass -> {pid: flagsString} for windows with any flag set,
// choosing the same window per pid as mainWindow (first visible, upgrade to
// first titled). Mirrors windowctl.flags_map().
function flagsMap() {
  const chosen = new Map();  // pid -> {hwnd, titled}
  enumTopLevel((hwnd, pid) => {
    if (!IsWindowVisible(hwnd) || !isNull(GetWindow(hwnd, GW_OWNER))) return;
    const titled = GetWindowTextLengthW(hwnd) > 0;
    const cur = chosen.get(pid);
    if (!cur || (titled && !cur.titled)) chosen.set(pid, { hwnd, titled });
  });
  const out = {};
  for (const [pid, { hwnd }] of chosen) {
    const f = windowFlags(hwnd);
    if (f) out[pid] = f;
  }
  return out;
}

// --- flags read ------------------------------------------------------------
const exStyle = (h) => Number(GetWindowLongPtrW(H(h), GWL_EXSTYLE)) >>> 0;

function getAlpha(h) {
  const style = exStyle(h);
  if (!(style & WS_EX_LAYERED)) return 255;
  const key = [0], a = [0], flags = [0];
  if (GetLayeredWindowAttributes(H(h), key, a, flags) && (flags[0] & LWA_ALPHA))
    return a[0] & 0xff;
  return 255;
}

function windowFlags(h) {
  const out = [];
  const style = exStyle(h);
  if (style & WS_EX_TOPMOST) out.push("T");
  const aff = [0];
  if (GetWindowDisplayAffinity(H(h), aff) && aff[0] === WDA_EXCLUDEFROMCAPTURE) out.push("P");
  if ((style & WS_EX_TOOLWINDOW) && !(style & WS_EX_APPWINDOW)) out.push("H");
  if (style & WS_EX_TRANSPARENT) out.push("C");
  const alpha = getAlpha(h);
  if (alpha < 255) out.push(`${Math.round((alpha / 255) * 100)}%`);
  return out.join(" ");
}

// --- flags write -----------------------------------------------------------
function setTopmost(h, enable) {
  const ok = SetWindowPos(H(h), enable ? HWND_TOPMOST : HWND_NOTOPMOST,
    0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  return [!!ok, `Always-on-top ${enable ? "on" : "off"}`];
}

function setAlpha(h, alpha) {
  alpha = Math.max(0, Math.min(255, Math.trunc(alpha)));
  const style = exStyle(h);
  if (!(style & WS_EX_LAYERED)) SetWindowLongPtrW(H(h), GWL_EXSTYLE, style | WS_EX_LAYERED);
  if (!SetLayeredWindowAttributes(H(h), 0, alpha, LWA_ALPHA))
    return [false, "Could not set opacity"];
  return [true, `Opacity ${Math.round((alpha / 255) * 100)}%`];
}

function setTaskbarHidden(h, hidden) {
  let style = exStyle(h);
  style = hidden ? (style & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW
                 : (style & ~WS_EX_TOOLWINDOW) | WS_EX_APPWINDOW;
  ShowWindow(H(h), SW_HIDE);                 // button only refreshes across hide/show
  SetWindowLongPtrW(H(h), GWL_EXSTYLE, style >>> 0);
  ShowWindow(H(h), SW_SHOW);
  return [true, `Taskbar button ${hidden ? "hidden" : "shown"}`];
}

function setClickThrough(h, enable) {
  const style = exStyle(h);
  if (enable) {
    const newlyLayered = !(style & WS_EX_LAYERED);
    SetWindowLongPtrW(H(h), GWL_EXSTYLE, (style | WS_EX_LAYERED | WS_EX_TRANSPARENT) >>> 0);
    if (newlyLayered) SetLayeredWindowAttributes(H(h), 0, 255, LWA_ALPHA);
  } else {
    SetWindowLongPtrW(H(h), GWL_EXSTYLE, (style & ~WS_EX_TRANSPARENT) >>> 0);
  }
  return [true, `Click-through ${enable ? "on" : "off"}`];
}

// --- capture protection (with remote-thread injection) ---------------------
function targetBits(handle) {
  const wow = [false];
  if (IsWow64Process(handle, wow) && wow[0]) return 32; // WOW64 32-bit on 64-bit OS
  return OUR_BITS;
}

// Position-independent x64 stub: SetWindowDisplayAffinity(hwnd, aff); ret BOOL.
function affinityShellcode(hwnd, affinity) {
  if (OUR_BITS !== 64) throw new Error("prototype builds x64 shellcode only");
  const b = Buffer.alloc(40);   // stub is 36 bytes; over-allocate (writes past end are silently dropped)
  let o = 0;
  b[o++] = 0x48; b[o++] = 0xb9; b.writeBigUInt64LE(H(hwnd), o); o += 8;   // mov rcx, hwnd
  b[o++] = 0xba; b.writeUInt32LE(affinity >>> 0, o); o += 4;             // mov edx, aff
  b[o++] = 0x48; b[o++] = 0xb8; b.writeBigUInt64LE(H(SWDA_ADDR), o); o += 8; // mov rax,&SWDA
  b[o++] = 0x48; b[o++] = 0x83; b[o++] = 0xec; b[o++] = 0x28;           // sub rsp,0x28
  b[o++] = 0xff; b[o++] = 0xd0;                                         // call rax
  b[o++] = 0x48; b[o++] = 0x83; b[o++] = 0xc4; b[o++] = 0x28;           // add rsp,0x28
  b[o++] = 0xc3;                                                        // ret
  return b.subarray(0, o);
}

function injectSetAffinity(pid, hwnd, affinity) {
  const h = OpenProcess(PROCESS_INJECT_ACCESS, false, pid);
  if (isNull(h))
    return [false, `Can't open PID ${pid} (error ${GetLastError()}) — try running as admin`];
  try {
    const bits = targetBits(h);
    if (bits !== OUR_BITS)
      return [false, `can't protect a ${bits}-bit window from a ${OUR_BITS}-bit build (architecture mismatch)`];
    const code = affinityShellcode(hwnd, affinity);
    const mem = VirtualAllocEx(h, null, code.length, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE);
    if (isNull(mem)) return [false, `VirtualAllocEx failed (error ${GetLastError()})`];
    try {
      const written = [0];
      if (!WriteProcessMemory(h, mem, code, code.length, written))
        return [false, `WriteProcessMemory failed (error ${GetLastError()})`];
      const tid = [0];
      const th = CreateRemoteThread(h, null, 0, mem, null, 0, tid);
      if (isNull(th))
        return [false, `CreateRemoteThread failed (error ${GetLastError()}) — target may block injection`];
      try {
        WaitForSingleObject(th, 5000);
        const rc = [0];
        GetExitCodeThread(th, rc);
        if (rc[0] === 1) return [true, "applied inside target process"];
        if (rc[0] === 0)
          return [false, "window refused capture protection (console / protected windows can't be excluded)"];
        return [false, `injection aborted (0x${(rc[0] >>> 0).toString(16).padStart(8, "0")}); protection not applied`];
      } finally { CloseHandle(th); }
    } finally { VirtualFreeEx(h, mem, 0, MEM_RELEASE); }
  } finally { CloseHandle(h); }
}

function setCaptureProtect(h, enable) {
  const affinity = enable ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE;
  if (SetWindowDisplayAffinity(H(h), affinity))
    return [true, `Capture protection ${enable ? "on" : "off"}`];
  const err = GetLastError();
  if (err !== 5) return [false, `Capture protection failed (error ${err})`];  // not ownership denial
  if (NO_INJECT_CLASSES.has(windowClass(h)))
    return [false, "console windows can't be excluded from screen capture"];
  const pid = ownerPid(h);
  if (!pid) return [false, "Capture protection denied and window owner is unknown"];
  const [ok, msg] = injectSetAffinity(pid, h, affinity);
  return ok ? [true, `Capture protection ${enable ? "on" : "off"} (${msg})`] : [false, msg];
}

module.exports = {
  cursorPos, pidFromPoint, isWindow, windowClass, mainWindow, getWindowsForPid,
  windowFlags, flagsMap, getAlpha, setTopmost, setAlpha, setTaskbarHidden,
  setClickThrough, setCaptureProtect, _addr: (h) => koffi.address(H(h)),
};
