"use strict";
// koffi port of processes.py — process list/kill, no psutil.
// Uses Toolhelp snapshot for listing and TerminateProcess for kill.
const koffi = require("koffi");
const kernel32 = koffi.load("kernel32.dll");

const PROCESSENTRY32W = koffi.struct("PROCESSENTRY32W", {
  dwSize: "uint32", cntUsage: "uint32", th32ProcessID: "uint32",
  th32DefaultHeapID: "size_t", th32ModuleID: "uint32", cntThreads: "uint32",
  th32ParentProcessID: "uint32", pcPriClassBase: "int32", dwFlags: "uint32",
  szExeFile: koffi.array("uint16", 260),
});

const CreateToolhelp32Snapshot = kernel32.func(
  "void* __stdcall CreateToolhelp32Snapshot(uint32 flags, uint32 pid)");
const Process32FirstW = kernel32.func(
  "bool __stdcall Process32FirstW(void *snap, _Inout_ PROCESSENTRY32W *pe)");
const Process32NextW = kernel32.func(
  "bool __stdcall Process32NextW(void *snap, _Inout_ PROCESSENTRY32W *pe)");
const CloseHandle = kernel32.func("bool __stdcall CloseHandle(void *h)");
const OpenProcess = kernel32.func("void* __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)");
const TerminateProcess = kernel32.func("bool __stdcall TerminateProcess(void *h, uint32 code)");
const GetLastError = kernel32.func("uint32 __stdcall GetLastError()");

const TH32CS_SNAPPROCESS = 0x00000002;
const INVALID = 0xffffffffffffffffn;
const PROCESS_TERMINATE = 0x0001;

function wstr(arr) {            // uint16[] -> string up to NUL
  let s = "";
  for (const c of arr) { if (!c) break; s += String.fromCharCode(c); }
  return s;
}

function listProcesses(sortBy = "name") {
  const snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap === INVALID) return [];
  const procs = [];
  try {
    const pe = { dwSize: koffi.sizeof(PROCESSENTRY32W) };
    let ok = Process32FirstW(snap, pe);
    while (ok) {
      procs.push({ pid: pe.th32ProcessID, name: wstr(pe.szExeFile) });
      pe.dwSize = koffi.sizeof(PROCESSENTRY32W);  // reset before reuse
      ok = Process32NextW(snap, pe);
    }
  } finally { CloseHandle(snap); }
  procs.sort(sortBy === "pid"
    ? (a, b) => a.pid - b.pid
    : (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return procs;
}

function killProcess(pid) {
  const h = OpenProcess(PROCESS_TERMINATE, false, pid);
  if (!h || h === 0n)
    return [false, `Access denied killing PID ${pid} (error ${GetLastError()}) — try running as admin`];
  try {
    if (!TerminateProcess(h, 1)) return [false, `TerminateProcess failed (error ${GetLastError()})`];
    return [true, `Killed PID ${pid}`];
  } finally { CloseHandle(h); }
}

module.exports = { listProcesses, killProcess };
