"use strict";

const fs = require("fs");

const LIMITS = Object.freeze({ week: 15, day: 15, hour: 3, suspectCooldownMs: 2 * 60 * 60 * 1000 });
const WINDOWS = Object.freeze({ hour: 60 * 60 * 1000, minutes15: 15 * 60 * 1000, day: 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000 });

class AccountSafetyController {
  constructor({ db, logFile, now = Date.now, safeMode = process.env.MODOLIVIO_SAFE_MODE !== "0", onTrip = /** @type {(event: any) => void} */ (() => {}) }) {
    this.db = db; this.logFile = logFile; this.now = now; this.safeMode = safeMode; this.onTrip = onTrip;
    this.db.exec(`CREATE TABLE IF NOT EXISTS safety_events(id INTEGER PRIMARY KEY, profile_id TEXT NOT NULL, type TEXT NOT NULL, at INTEGER NOT NULL, detail TEXT)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS safety_events_profile_at ON safety_events(profile_id, at)`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS safety_state(profile_id TEXT PRIMARY KEY, circuit_open INTEGER NOT NULL DEFAULT 0, cooldown_until INTEGER NOT NULL DEFAULT 0, reason TEXT)`);
    this.db.prepare("DELETE FROM safety_events WHERE at < ?").run(this.now() - WINDOWS.week);
  }
  assertCanStart(profileId) {
    if (!profileId || !/^[a-zA-Z0-9_-]{1,80}$/.test(profileId)) throw new Error("A stable per-account profileId is required");
    const state = this.db.prepare("SELECT * FROM safety_state WHERE profile_id=?").get(profileId);
    if (state?.circuit_open || (state?.cooldown_until || 0) > this.now()) throw new Error(`Safe Mode đã dừng profile ${profileId}: ${state.reason || "cooldown"}`);
    const now = this.now();
    const counts = {
      hour: this.count(profileId, "video", now - WINDOWS.hour),
      day: this.count(profileId, "video", now - WINDOWS.day),
      week: this.count(profileId, "video", now - WINDOWS.week),
    };
    if (counts.hour >= LIMITS.hour || counts.day >= LIMITS.day || counts.week >= LIMITS.week) throw new Error(`Đã chạm hạn mức an toàn (giờ=${counts.hour}/${LIMITS.hour}, ngày=${counts.day}/${LIMITS.day}, tuần=${counts.week}/${LIMITS.week})`);
    if (this.safeMode && this.count(profileId, "prompt_rejected", now - WINDOWS.hour) >= 2) throw new Error("Safe Mode tạm dừng sau 2 lần prompt bị từ chối; cần rà soát thủ công");
    this.record(profileId, "video", {});
    return { profileId, counts: { hour: counts.hour + 1, day: counts.day + 1, week: counts.week + 1 }, safeMode: this.safeMode };
  }
  assertCanContinue(profileId) {
    const state = this.db.prepare("SELECT circuit_open,cooldown_until,reason FROM safety_state WHERE profile_id=?").get(profileId);
    if (state?.circuit_open || (state?.cooldown_until || 0) > this.now()) throw new Error(`Safety circuit is open for profile ${profileId}: ${state.reason || "cooldown"}`);
    return true;
  }
  observe(profileId, type, detail = {}) {
    this.record(profileId, type, detail);
    const now = this.now();
    const recent = (name, windowMs) => this.count(profileId, name, now - windowMs);
    const trip = (reason, cooldown = 0) => this.trip(profileId, reason, cooldown, detail);
    if (["401", "403", "login_required", "429", "captcha", "oidc_redirect", "suspect_die", "credit_exhausted_early"].includes(type)) {
      if (type === "suspect_die") return recent(type, WINDOWS.day) > 2 ? trip("SUSPECT_DIE > 2/day", LIMITS.suspectCooldownMs) : trip("SUSPECT_DIE", LIMITS.suspectCooldownMs);
      if (["401", "403", "login_required"].includes(type)) return trip("session health requires user sign-in");
      return trip(type === "429" || type === "captcha" ? `${type}: stop and require user review` : type);
    }
    if (type === "prompt_rejected" && recent(type, WINDOWS.hour) >= 3) return trip("3 rejected prompts in one hour");
    if (type === "cookie_refresh" && recent(type, WINDOWS.hour) > 2) return trip("more than 2 session refreshes in one hour");
    if (type === "still_sending" && recent(type, WINDOWS.minutes15) >= 2) return trip("still sending twice in 15 minutes");
    if (type === "slow_render" && Number(detail.durationRatio) >= 2.5) return trip("render latency >= 2.5x baseline");
    if (type === "slow_thread" && Number(detail.durationMs) > 5000) return trip("thread creation > 5 seconds");
    return { tripped: false };
  }
  trip(profileId, reason, cooldownMs = 0, detail = {}) {
    const until = cooldownMs ? this.now() + cooldownMs : 0;
    this.db.prepare(`INSERT INTO safety_state(profile_id,circuit_open,cooldown_until,reason) VALUES(?,1,?,?)
      ON CONFLICT(profile_id) DO UPDATE SET circuit_open=1,cooldown_until=MAX(safety_state.cooldown_until,excluded.cooldown_until),reason=excluded.reason`)
      .run(profileId, until, reason);
    const event = { profileId, type: "CIRCUIT_BREAKER", reason, cooldownUntil: until, at: this.now(), detail };
    try { fs.appendFileSync(this.logFile, `${JSON.stringify(event)}\n`, { mode: 0o600 }); } catch { /* database still contains state */ }
    this.onTrip(event); return { tripped: true, ...event };
  }
  clearByUser(profileId) {
    this.db.prepare("DELETE FROM safety_state WHERE profile_id=?").run(profileId);
    this.record(profileId, "user_cleared_circuit", {});
  }
  status(profileId) {
    return this.db.prepare("SELECT circuit_open AS circuitOpen,cooldown_until AS cooldownUntil,reason FROM safety_state WHERE profile_id=?").get(profileId) || { circuitOpen: 0, cooldownUntil: 0, reason: null };
  }
  record(profileId, type, detail) { this.db.prepare("INSERT INTO safety_events(profile_id,type,at,detail) VALUES(?,?,?,?)").run(profileId, type, this.now(), JSON.stringify(detail)); }
  count(profileId, type, since) { return Number(this.db.prepare("SELECT COUNT(*) AS n FROM safety_events WHERE profile_id=? AND type=? AND at>=?").get(profileId, type, since)?.n || 0); }
}

module.exports = { LIMITS, WINDOWS, AccountSafetyController };
