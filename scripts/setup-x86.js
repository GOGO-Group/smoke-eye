"use strict";
// Fetches the two 32-bit binaries the x86 capture-protection helper needs:
//   - node_modules/@koromix/koffi-win32-ia32  (32-bit koffi prebuilt)
//   - vendor/node32/node.exe                  (32-bit node runtime, ~74 MB)
// `npm install` on an x64 host only grabs the x64 koffi (cpu match) and never
// the 32-bit node, so run `npm run setup-x86` after install to enable
// protecting 32-bit (WOW64) windows such as VMware Workstation's.
// Idempotent: valid existing files are left alone (pass --force to refetch).

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const NODE_VERSION = "v22.13.1";
const KOFFI_VERSION = "3.0.2";
const FORCE = process.argv.includes("--force");

const KOFFI_DIR = path.join(
  ROOT,
  "node_modules",
  "@koromix",
  "koffi-win32-ia32",
);
const KOFFI_BIN = path.join(KOFFI_DIR, "win32_ia32", "koffi.node");
const KOFFI_TGZ = `https://registry.npmjs.org/@koromix/koffi-win32-ia32/-/koffi-win32-ia32-${KOFFI_VERSION}.tgz`;

const NODE32_EXE = path.join(ROOT, "vendor", "node32", "node.exe");
const NODE32_URL = `https://nodejs.org/dist/${NODE_VERSION}/win-x86/node.exe`;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const { statusCode, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          return resolve(download(headers.location, dest));
        }
        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`${url} -> HTTP ${statusCode}`));
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve()));
        out.on("error", reject);
      })
      .on("error", reject);
  });
}

function systemTar() {
  const sys = process.env.SystemRoot || "C:\\Windows";
  const p = path.join(sys, "System32", "tar.exe");
  return fs.existsSync(p) ? p : "tar";
}

async function ensureKoffi() {
  if (!FORCE && fs.existsSync(KOFFI_BIN)) return console.log("koffi (ia32): present");
  console.log("koffi (ia32): fetching...");
  const tgz = path.join(ROOT, "vendor", `koffi-ia32-${KOFFI_VERSION}.tgz`);
  const tmp = path.join(ROOT, "vendor", "koffi-ia32-tmp");
  await download(KOFFI_TGZ, tgz);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  execFileSync(systemTar(), ["-xzf", tgz, "-C", tmp], { stdio: "inherit" });
  fs.rmSync(KOFFI_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(KOFFI_DIR), { recursive: true });
  fs.renameSync(path.join(tmp, "package"), KOFFI_DIR);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(tgz, { force: true });
  if (!fs.existsSync(KOFFI_BIN))
    throw new Error("koffi ia32 binary missing after extract");
  console.log("koffi (ia32): installed");
}

async function ensureNode32() {
  if (!FORCE && fs.existsSync(NODE32_EXE) && fs.statSync(NODE32_EXE).size > 1e7)
    return console.log("node32: present");
  console.log(`node32: downloading ${NODE_VERSION} win-x86 (~74 MB)...`);
  await download(NODE32_URL, NODE32_EXE);
  console.log("node32: installed ->", NODE32_EXE);
}

(async () => {
  try {
    await ensureKoffi();
    await ensureNode32();
    console.log("x86 helper ready.");
  } catch (e) {
    console.error("setup-x86 failed:", e.message);
    process.exit(1);
  }
})();
