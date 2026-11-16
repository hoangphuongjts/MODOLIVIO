"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PROFILE_RE = /^[a-zA-Z0-9_-]{1,80}$/;

/** Stores user-authorized access/refresh tokens, never browser cookies/passwords. */
class MuseSessionVault {
  constructor({ directory, safeStorage }) {
    this.directory = directory; this.safeStorage = safeStorage; this.keyFile = path.join(directory, "muse-vault.key");
    this.recordsFile = path.join(directory, "muse-vault.json"); this.key = null;
  }
  initialize() {
    if (!this.safeStorage?.isEncryptionAvailable?.()) throw new Error("DPAPI/safeStorage encryption is unavailable; session vault stays locked");
    const backend = this.safeStorage.getSelectedStorageBackend?.() || "unknown";
    if (["basic_text", "unknown"].includes(backend)) throw new Error(`Unsafe safeStorage backend '${backend}'; session vault stays locked`);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.keyFile)) {
      const wrapped = fs.readFileSync(this.keyFile, "utf8");
      this.key = Buffer.from(this.safeStorage.decryptString(Buffer.from(wrapped, "base64")), "base64");
    } else {
      this.key = crypto.randomBytes(32);
      const wrapped = this.safeStorage.encryptString(this.key.toString("base64")).toString("base64");
      this.atomicWrite(this.keyFile, wrapped, 0o600);
    }
    if (this.key.length !== 32) throw new Error("Invalid encrypted vault key");
    if (!fs.existsSync(this.recordsFile)) this.atomicWrite(this.recordsFile, "{}", 0o600);
    return { backend, ready: true };
  }
  store(profileId, session) {
    this.assertReady(); this.assertProfile(profileId);
    if (!session || typeof session.accessToken !== "string" || session.accessToken.length < 8 || session.accessToken.length > 16_384) throw new Error("A valid user-authorized accessToken is required");
    if (Object.keys(session).some((key) => /cookie|password|secret/i.test(key))) throw new Error("Cookies/passwords are not accepted by this vault");
    const safe = { accessToken: session.accessToken, refreshToken: typeof session.refreshToken === "string" ? session.refreshToken : null,
      expiresAt: Number.isFinite(session.expiresAt) ? session.expiresAt : null, savedAt: Date.now(), source: "user-authorized-token" };
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`mo-muse:${profileId}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(safe)), cipher.final()]);
    const records = this.readRecords();
    records[profileId] = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") };
    this.atomicWrite(this.recordsFile, JSON.stringify(records), 0o600);
    return { profileId, partition: this.partition(profileId), savedAt: safe.savedAt };
  }
  read(profileId) {
    this.assertReady(); this.assertProfile(profileId);
    const record = this.readRecords()[profileId]; if (!record) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(record.iv, "base64"));
    decipher.setAAD(Buffer.from(`mo-muse:${profileId}`)); decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, "base64")), decipher.final()]).toString("utf8"));
  }
  remove(profileId) { this.assertReady(); this.assertProfile(profileId); const records = this.readRecords(); delete records[profileId]; this.atomicWrite(this.recordsFile, JSON.stringify(records), 0o600); }
  partition(profileId) { this.assertProfile(profileId); return `persist:mo-muse-${profileId}`; }
  assertReady() { if (!this.key) throw new Error("MuseSessionVault has not been initialized"); }
  assertProfile(profileId) { if (!PROFILE_RE.test(String(profileId || ""))) throw new Error("Invalid Muse profileId"); }
  readRecords() { try { return JSON.parse(fs.readFileSync(this.recordsFile, "utf8")); } catch { return {}; } }
  atomicWrite(filename, contents, mode) {
    const temp = `${filename}.${process.pid}.tmp`; fs.writeFileSync(temp, contents, { mode }); fs.renameSync(temp, filename);
    try { fs.chmodSync(filename, mode); } catch { /* Windows ACLs are inherited from userData */ }
  }
  lock() { this.key?.fill(0); this.key = null; }
}

module.exports = { MuseSessionVault, PROFILE_RE };
