"use strict";
// 32-bit injector helper. Runs under the bundled 32-bit node (vendor/node32)
// so it can inject a native x86 stub into WOW64 (32-bit) target processes —
// something the 64-bit app cannot do directly. Spawned by
// windowctl.injectViaHelper with the same-bitness target guaranteed.
//
// Usage:  node inject32.js <pid> <hwnd> <affinity>
// Output: one JSON line on stdout: {"ok":bool,"msg":string}; exit 0 on success.
const wc = require("./windowctl");

function emit(ok, msg) {
  process.stdout.write(JSON.stringify({ ok: !!ok, msg: String(msg) }) + "\n");
  process.exit(ok ? 0 : 1);
}

try {
  const [pidArg, hwndArg, affArg] = process.argv.slice(2);
  if (pidArg == null || hwndArg == null || affArg == null)
    emit(false, "usage: inject32.js <pid> <hwnd> <affinity>");
  const [ok, msg] = wc.injectAffinity(
    Number(pidArg),
    BigInt(hwndArg),
    Number(affArg),
  );
  emit(ok, msg);
} catch (e) {
  emit(false, (e && e.message) || String(e));
}
