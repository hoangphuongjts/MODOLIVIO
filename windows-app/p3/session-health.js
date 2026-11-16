"use strict";

const AUTH_MARKERS = /login required|sign in|captcha|verify you are human|\/oidc(?:\/|$)/i;

class SessionHealthMonitor {
  constructor({ profileId, onInvalid = /** @type {(event: any) => void} */ (() => {}), onHeartbeat = /** @type {(event: any) => void} */ (() => {}), now = Date.now }) {
    this.profileId = profileId; this.onInvalid = onInvalid; this.onHeartbeat = onHeartbeat; this.now = now;
    this.lastHeartbeat = now(); this.lastSignalAt = 0; this.stopped = false;
  }
  observeResponse({ status, url = "", bodyText = "" }) {
    if (this.stopped) return false;
    const invalid = status === 401 || status === 403 || AUTH_MARKERS.test(`${url} ${String(bodyText).slice(0, 4096)}`);
    if (!invalid) return false;
    const at = this.now(); if (at - this.lastSignalAt < 2000) return true;
    const marker = `${url} ${String(bodyText).slice(0, 4096)}`;
    const reason = status === 401 ? "401" : status === 403 ? "403" : /captcha|verify you are human/i.test(marker) ? "captcha" : /\/oidc(?:\/|$)/i.test(marker) ? "oidc_redirect" : "login_required";
    this.lastSignalAt = at; this.onInvalid({ profileId: this.profileId, status, url, reason, detectedInMs: 0, at }); return true;
  }
  heartbeat() { this.lastHeartbeat = this.now(); this.onHeartbeat({ profileId: this.profileId, at: this.lastHeartbeat }); }
  start() { this.stop(); this.stopped = false; this.timer = setInterval(() => this.heartbeat(), 15 * 60 * 1000); this.timer.unref?.(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.stopped = true; }
}

/** User-assisted recovery only: opens a visible sign-in page, never fills credentials or solves challenges. */
class AutoReloginEngine {
  constructor({ openUserSignIn, maxAttempts = 2, onState = /** @type {(event: any) => void} */ (() => {}) }) { this.openUserSignIn = openUserSignIn; this.maxAttempts = maxAttempts; this.onState = onState; this.attempts = new Map(); }
  async sessionInvalid(profileId, reason) {
    const count = this.attempts.get(profileId) || 0;
    if (count >= this.maxAttempts) { this.onState({ profileId, state: "reauth-limit-reached", count }); return false; }
    this.attempts.set(profileId, count + 1);
    this.onState({ profileId, state: "user-sign-in-required", attempt: count + 1, reason });
    await this.openUserSignIn(profileId);
    return true;
  }
  markUserConfirmed(profileId) { this.attempts.delete(profileId); this.onState({ profileId, state: "user-confirmed" }); }
}

module.exports = { AUTH_MARKERS, SessionHealthMonitor, AutoReloginEngine };
