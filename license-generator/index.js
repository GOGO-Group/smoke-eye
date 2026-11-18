"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const APP_ID = "com.processc.floating-controller";
const PRIVATE_KEY = fs.readFileSync(
  path.join(__dirname, "private-key.pem"),
  "utf8",
);

function parseArgs(argv) {
  const options = { features: ["safe"] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--name") options.name = argv[++i];
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--expires") options.expiresAt = argv[++i];
    else if (arg === "--feature") options.features.push(argv[++i]);
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  console.log(
    [
      "Usage:",
      '  node index.js --name "Customer" --out license.json --expires 2027-12-31',
      "",
      "Options:",
      "  --name     License owner name (required)",
      "  --out      Output file path (default: ./license.json)",
      "  --expires  ISO date string or YYYY-MM-DD (optional)",
      "  --feature  Extra feature flag, may be repeated",
    ].join("\n"),
  );
}

function canonicalPayload(payload) {
  return JSON.stringify({
    appId: payload.appId,
    issuedTo: payload.issuedTo,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    features: payload.features,
  });
}

function generateLicense(options) {
  if (!options.name) throw new Error("--name is required");
  const payload = {
    appId: APP_ID,
    issuedTo: options.name,
    issuedAt: new Date().toISOString(),
    expiresAt: options.expiresAt || "",
    features: [...new Set(options.features || ["safe"])],
  };
  if (!payload.features.includes("safe")) payload.features.unshift("safe");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(canonicalPayload(payload));
  signer.end();
  const signature = signer.sign(PRIVATE_KEY, "base64");
  return { ...payload, signature };
}

function writeLicense(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

try {
  const options = parseArgs(process.argv);
  if (options.help) {
    usage();
    process.exit(0);
  }
  const license = generateLicense(options);
  const out = path.resolve(process.cwd(), options.out || "license.json");
  writeLicense(out, license);
  console.log(`Wrote license file: ${out}`);
} catch (error) {
  console.error(error.message || String(error));
  usage();
  process.exit(1);
}
