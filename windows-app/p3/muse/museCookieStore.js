// museCookieStore.js — Lưu bền két cookie Muse (code Gemini t1) xuống đĩa.
//
// Vấn đề: MuseSessionVault của Gemini chỉ giữ dữ liệu trong bộ nhớ (Map) —
// khởi động lại app là mất hết phiên Muse đã đồng bộ từ Extension.
// Module này bọc quanh vault: lưu các hàng đã mã hoá AES-256-GCM ra file JSON
// (0600) và bọc master secret bằng Electron safeStorage/DPAPI, theo đúng mẫu
// của p3/session-vault.js (tk2). File đĩa không lộ mật khẩu hay cookie vì
// các hàng đã là ciphertext; master secret chỉ nằm trong key file đã mã hoá.
//
// Viết bởi Annie khi tích hợp (không phải code Gemini/tk2).
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { MuseSessionVault } = require("./museSessionVault.js");

function atomicWrite(filename, contents, mode) {
  const temp = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temp, contents, { mode });
  fs.renameSync(temp, filename);
  try { fs.chmodSync(filename, mode); } catch { /* Windows ACLs are inherited */ }
}

/**
 * Khởi tạo (hoặc nạp lại) két cookie Muse.
 * @param {{directory: string, safeStorage: any}} options
 * @returns {{vault: MuseSessionVault, pairingSecret: string, ready: boolean, save: () => void, load: () => number}}
 */
function createMuseCookieStore({ directory, safeStorage }) {
  if (!safeStorage?.isEncryptionAvailable?.()) {
    throw new Error("DPAPI/safeStorage encryption is unavailable; muse cookie vault stays locked");
  }
  const backend = safeStorage.getSelectedStorageBackend?.() || "unknown";
  if (["basic_text", "unknown"].includes(backend)) {
    throw new Error(`Unsafe safeStorage backend '${backend}'; muse cookie vault stays locked`);
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  const keyFile = path.join(directory, "muse-cookie-vault.key");
  const secretFile = path.join(directory, "muse-pairing-secret.txt");
  const rowsFile = path.join(directory, "muse-cookies.json");

  let masterSecret;
  if (fs.existsSync(keyFile)) {
    const wrapped = fs.readFileSync(keyFile, "utf8");
    masterSecret = safeStorage.decryptString(Buffer.from(wrapped, "base64"));
  } else {
    masterSecret = crypto.randomBytes(32).toString("base64");
    const wrapped = safeStorage.encryptString(masterSecret).toString("base64");
    atomicWrite(keyFile, wrapped, 0o600);
  }
  if (!masterSecret || masterSecret.length < 16) {
    throw new Error("Invalid muse cookie vault master secret");
  }

  let pairingSecret;
  if (fs.existsSync(secretFile)) {
    pairingSecret = fs.readFileSync(secretFile, "utf8").trim();
  } else {
    pairingSecret = crypto.randomBytes(24).toString("hex");
    atomicWrite(secretFile, pairingSecret, 0o600);
  }
  if (!pairingSecret || pairingSecret.length < 16) {
    throw new Error("Invalid muse pairing secret");
  }

  const vault = new MuseSessionVault(masterSecret, pairingSecret);

  function save() {
    const rows = vault.exportEncryptedRows();
    atomicWrite(rowsFile, JSON.stringify(rows), 0o600);
    return rows.length;
  }

  function load() {
    if (!fs.existsSync(rowsFile)) return 0;
    try {
      const rows = JSON.parse(fs.readFileSync(rowsFile, "utf8"));
      return vault.importEncryptedRows(Array.isArray(rows) ? rows : []);
    } catch {
      return 0;
    }
  }

  load();
  return { vault, pairingSecret, ready: true, save, load };
}

module.exports = { createMuseCookieStore };
