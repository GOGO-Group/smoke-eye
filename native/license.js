"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app } = require("electron");

const APP_ID = "com.processc.floating-controller";
const LICENSE_FILE = "license.json";
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA8C05253BgEMwDCUNw03L
PBnhZeJaY32r9RLZYS2G1Xe8gMiEUa6fJAOGy0V5p6F9eTZshKeX/6P5S1Ysao/5
RDA/9JEN9G2KYLs/VhBkwz3AjAEkIBu91znswX2ubzgnOpKd9fim2pNW5RVB3l+y
05UIa90cZUkusr+RjqcbtcBwgxmDVNYiv7Log8c7BTbyhSKjSTONTUTC9UJTHlbV
e+wEL5eSjiMxcy96wAwJ5H9HflLTgZezYKBF74e02vpI0HmV9As1Nvog6NhrAJxO
My5wtShgsvPFruVYiOrtn4CAJiZcF3gwjlRXPsiqbrFEAp8tON72HWkj0THLNBph
3wIDAQAB
-----END PUBLIC KEY-----`;

function licensePath() {
  return path.join(app.getPath("userData"), LICENSE_FILE);
}

function licenseFileExists() {
  return fs.existsSync(resolveLicensePath());
}

function resolveLicensePath() {
  const candidates = [
    licensePath(),
    path.join(process.cwd(), LICENSE_FILE),
    path.join(__dirname, "..", LICENSE_FILE),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
  );
}

function canonicalPayload(data) {
  return JSON.stringify({
    appId: data.appId,
    issuedTo: data.issuedTo,
    issuedAt: data.issuedAt,
    expiresAt: data.expiresAt,
    features: data.features,
  });
}

function readLicense() {
  const file = resolveLicensePath();
  if (!fs.existsSync(file))
    return {
      exists: false,
      enabled: false,
      reason: "license file not found",
      path: file,
    };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const payload = {
      appId: raw.appId,
      issuedTo: raw.issuedTo,
      issuedAt: raw.issuedAt,
      expiresAt: raw.expiresAt,
      features: raw.features,
    };
    if (payload.appId !== APP_ID)
      return {
        exists: true,
        enabled: false,
        reason: "license is for a different app",
        path: file,
      };
    if (!Array.isArray(payload.features) || !payload.features.includes("safe"))
      return {
        exists: true,
        enabled: false,
        reason: "safe feature not granted",
        path: file,
      };
    const expiresAt = payload.expiresAt ? Date.parse(payload.expiresAt) : NaN;
    if (Number.isFinite(expiresAt) && expiresAt < Date.now())
      return {
        exists: true,
        enabled: false,
        reason: "license expired",
        path: file,
      };
    const signature = String(raw.signature || "").trim();
    if (!signature)
      return {
        exists: true,
        enabled: false,
        reason: "license signature missing",
        path: file,
      };
    const verify = crypto.createVerify("RSA-SHA256");
    verify.update(canonicalPayload(payload));
    verify.end();
    if (!verify.verify(PUBLIC_KEY, Buffer.from(signature, "base64")))
      return {
        exists: true,
        enabled: false,
        reason: "license signature invalid",
        path: file,
      };
    return {
      exists: true,
      enabled: true,
      reason: "license valid",
      path: file,
      issuedTo: raw.issuedTo,
      expiresAt: raw.expiresAt,
      features: raw.features,
    };
  } catch (error) {
    return {
      exists: true,
      enabled: false,
      reason: error.message || "could not read license",
      path: file,
    };
  }
}

module.exports = {
  status: readLicense,
  licensePath,
  licenseFileExists,
  resolveLicensePath,
  canonicalPayload,
  APP_ID,
};
