// museProvider.js — Động cơ Muse (muse.ai) dưới dạng Provider cho RenderPipeline.
//
// Nối động cơ CDP của Gemini (t3, p3/muse/museCdpEngine.js) vào đúng interface
// mà pipeline của tk2 yêu cầu: submit({prompt, imageUrl, ...}) -> {taskId} và
// getTask(taskId) -> {status, video_url | localFile}. Mỗi cảnh của pipeline
// thành 1 job động cơ Muse (1 scene), chạy tuần tự theo đúng giới hạn
// Concurrency = 1 của động cơ. File MP4 động cơ tải về cục bộ được trả qua
// trường localFile — pipeline đã được sửa để nhận localFile thay vì chỉ tải
// qua HTTPS (xem p3/pipeline.js, [MUSE-INTEGRATION]).
//
// Viết bởi Annie khi tích hợp (không phải code Gemini/tk2).
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  MusePlaywrightEngine,
  FileBackedWalStore,
  MuseAccountPoolGuard,
} = require("./museCdpEngine.js");

const FACE_LOCK_MIN = 0.95;
const MAX_SCENE_WAIT_MS = 15 * 60 * 1000; // khớp deadline poll 15 phút của pipeline

function sanitizeTaskId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function isSafeHttpsImageUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "https:") return false;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i.test(url.hostname)) return false;
  return true;
}

/** Tài khoản động cơ Muse từ hồ sơ két cookie (mọi hồ sơ đều gieo ACTIVE; động cơ tự phát hiện 401/403 và tự đăng nhập lại tối đa 1 lần/12h). */
function slotFromVaultProfile(summary, vault) {
  const proxy = vault.getActiveProxy(summary.profileId);
  return {
    accountId: summary.profileId,
    status: "ACTIVE",
    proxy: proxy ? { server: `${proxy.protocol}://${proxy.host}:${proxy.port}` } : undefined,
    viewport: { width: 1280, height: 800 },
    dailyScenesUsed: 0,
    dailyScenesLimit: 15, // khớp hạn mức Safe Mode ngày của tk2 (15 clip/ngày)
    lastUsedAtMs: 0,
    cooldownUntilMs: 0,
    reloginCount12h: 0,
    lastReloginAtMs: 0,
  };
}

class MuseProvider {
  /**
   * @param {any} [options] - engineFactory (tiem dong co gia khi test; mac dinh
   * tao dong co that), cookieVault (ket cookie Gemini), dataDir (bat buoc:
   * thu muc du lieu Bridge, chua muse-wal/ + muse-cache/), bridgePort
   * (mac dinh 19740), emit, safety (AccountSafetyController cua tk2),
   * fetchImpl, chromeExecutablePath.
   */
  constructor(options = {}) {
    const { engineFactory, cookieVault, dataDir, bridgePort = 19740, emit = () => {}, safety = null, fetchImpl = fetch, chromeExecutablePath } = options;
    if (!dataDir) throw new Error("MuseProvider cần dataDir");
    // Live CDP may only use the explicitly nominated sacrificial profile.
    // Unit tests can supply a fake engineFactory without an account.
    this.allowedProfileId = options.allowedProfileId || process.env.MODOLIVIO_MUSE_ALLOWED_PROFILE_ID || "";
    if (!engineFactory && !this.allowedProfileId) {
      throw new Error("MUSE_PROFILE_NOT_APPROVED: set MODOLIVIO_MUSE_ALLOWED_PROFILE_ID for the HY SINH profile before enabling live Muse");
    }
    this.cookieVault = cookieVault || null;
    this.bridgePort = bridgePort;
    this.chromeExecutablePath = chromeExecutablePath || undefined;
    this.emit = emit;
    this.safety = safety;
    this.fetch = fetchImpl;
    this.cacheDir = path.join(dataDir, "muse-cache");
    this.walDir = path.join(dataDir, "muse-wal");
    this.profileDir = path.join(dataDir, "muse-profiles");
    fs.mkdirSync(this.cacheDir, { recursive: true });
    this.jobs = new Map(); // taskId -> {status, localFile, error}
    this.engineFactory = engineFactory || (() => this.createRealEngine());
    this.engine = null;
  }

  createRealEngine() {
    const store = new FileBackedWalStore(this.walDir, this.listSeedAccounts());
    const guard = new MuseAccountPoolGuard(store);
    const safety = this.safety;
    const emit = this.emit;
    const engine = new MusePlaywrightEngine(store, guard, {
      museBaseUrl: "https://muse.ai",
      baseProfileDir: this.profileDir,
      baseCacheDir: this.cacheDir,
      chromeExecutablePath: this.chromeExecutablePath,
      onHeartbeat: (jobId, step, percent) => emit({ type: "muse-engine", state: "heartbeat", jobId, step, percent }),
      onCheckpointSave: () => {},
      onSilentRefreshToken: async (_jobId, currentToken) => ({ token: currentToken, expiresAtMs: Date.now() + 3600_000 }),
      onActionRequired: (_jobId, accountId, reason) => {
        emit({ type: "muse-engine", state: "action-required", accountId, reason });
        try { safety?.observe(accountId, reason === "CAPTCHA_REQUIRED" ? "captcha" : "login_required", {}); } catch { /* safety là tùy chọn */ }
      },
      onSecurityAlert: (event) => {
        emit({ type: "muse-engine", state: "security-alert", ...event });
        try {
          if (event.code === "SUSPECT_DIE") safety?.observe(event.accountId, "suspect_die", {});
          if (event.code === "CIRCUIT_BREAKER_OPEN") safety?.observe(event.accountId, "429", {});
        } catch { /* safety là tùy chọn */ }
      },
      onTriggerCloudFallback: async (jobId, reason) => {
        emit({ type: "muse-engine", state: "cloud-fallback", jobId, reason });
      },
    });
    return engine;
  }

  listSeedAccounts() {
    if (!this.cookieVault) return [];
    return this.cookieVault.listAllSummaries()
      .filter((summary) => summary.profileId === this.allowedProfileId)
      .map((s) => slotFromVaultProfile(s, this.cookieVault));
  }

  /** Đồng bộ hồ sơ két cookie vào WAL store, giữ nguyên bộ đếm/cooldown đã lưu. */
  syncAccountsIntoStore() {
    if (!this.cookieVault || !this.engine) return;
    const store = this.engine.store || null;
    if (!store || typeof store.upsertAccount !== "function" || typeof store.getAccount !== "function") return;
    for (const summary of this.cookieVault.listAllSummaries().filter((item) => item.profileId === this.allowedProfileId)) {
      const fresh = slotFromVaultProfile(summary, this.cookieVault);
      const existing = store.getAccount(summary.profileId);
      if (existing) {
        store.upsertAccount({ ...existing, proxy: fresh.proxy, status: existing.status === "ACTIVE" ? "ACTIVE" : existing.status });
      } else {
        store.upsertAccount(fresh);
      }
    }
  }

  getEngine() {
    if (!this.engine) this.engine = this.engineFactory();
    return this.engine;
  }

  async downloadImageToCache(imageUrl) {
    if (!isSafeHttpsImageUrl(imageUrl)) throw new Error("Ảnh gốc phải dùng HTTPS công khai");
    const response = await this.fetch(imageUrl, { signal: AbortSignal.timeout(45000), redirect: "error" });
    if (!response.ok) throw new Error(`Không tải được ảnh gốc: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1024 || bytes.length > 50 * 1024 * 1024) throw new Error("Kích thước ảnh gốc không hợp lệ");
    const ext = (new URL(imageUrl).pathname.match(/\.(png|jpe?g|webp)$/i) || [null, "jpg"])[1].toLowerCase();
    const file = path.join(this.cacheDir, `orig-${crypto.createHash("sha256").update(imageUrl).digest("hex").slice(0, 16)}.${ext}`);
    fs.writeFileSync(file, bytes);
    return file;
  }

  /**
   * Nộp 1 cảnh cho động cơ Muse. Pipeline gọi hàm này rồi poll getTask().
   * Trả về ngay {taskId}; render chạy nền, lỗi/hết hạn được ghi vào bản ghi job.
   */
  async submit({ prompt, imageUrl, durationSec = 10, aspectRatio = "9:16", jobId, sceneIndex = 0, profileId, idempotencyKey, characterRefImagePath, originalProductImagePath, dialogue, voiceText, faceLockSimilarity }) {
    const taskId = `muse_${sanitizeTaskId(jobId || crypto.randomUUID())}_scene_${sceneIndex}`;
    const existing = this.jobs.get(taskId);
    if (existing && (existing.status === "processing" || existing.status === "succeeded")) {
      return { taskId, raw: existing };
    }
    if (!profileId) throw new Error("MuseProvider cần profileId (tài khoản Muse đã đăng nhập)");
    if (this.allowedProfileId && profileId !== this.allowedProfileId) {
      throw new Error("MUSE_PROFILE_DENIED: only the user-approved HY SINH profile may be used");
    }
    if (!Number.isFinite(faceLockSimilarity) || faceLockSimilarity < FACE_LOCK_MIN || faceLockSimilarity > 1) {
      throw new Error("Face Lock chưa được Python verifier xác nhận >= 95%; Muse job bị chặn");
    }
    if (!characterRefImagePath || !fs.existsSync(characterRefImagePath)) {
      throw new Error("Thiếu ảnh tham chiếu nhân vật (Face Lock) — cảnh Muse cần characterRefImagePath là file cục bộ");
    }
    const record = { status: "processing", localFile: null, video_url: null, error: null, startedAt: Date.now() };
    this.jobs.set(taskId, record);

    const run = (async () => {
      try {
        const originalPath = originalProductImagePath && fs.existsSync(originalProductImagePath)
          ? originalProductImagePath
          : await this.downloadImageToCache(imageUrl);
        this.syncAccountsIntoStore();
        const engine = this.getEngine();
        const checkpoints = await engine.executeJob({
          jobId: taskId,
          idempotencyKey: String(idempotencyKey || taskId),
          preferredAccountId: profileId,
          bridgePort: this.bridgePort,
          scopedToken: "",
          tokenExpiresAtMs: Date.now() + 3600_000,
          characterRefImagePath,
          originalProductImagePath: originalPath,
          compliancePassed: true,
          scenes: [{
            sceneIndex: sceneIndex + 1,
            durationSec: Math.max(5, Math.min(10, Number(durationSec) || 10)),
            visualPrompt: String(prompt || ""),
            voiceText: String(dialogue || voiceText || ""),
            hasMC: true,
            faceLockSimilarity,
            preserveOriginalProductImage: true,
            priceTagOverlaySec: 0,
          }],
        });
        const rendered = (checkpoints || []).find((c) => c.status === "RENDERED" && c.localMp4Path && fs.existsSync(c.localMp4Path));
        if (!rendered) throw new Error("Động cơ Muse không trả file MP4 cho cảnh này");
        record.status = "succeeded";
        record.localFile = rendered.localMp4Path;
        this.emit({ type: "muse-engine", state: "scene-done", taskId, localFile: record.localFile });
      } catch (error) {
        record.status = "failed";
        record.error = String((error && error.message) || error).slice(0, 1000);
        this.emit({ type: "muse-engine", state: "scene-failed", taskId, error: record.error });
      }
    })();
    void run;
    return { taskId, raw: record };
  }

  async getTask(taskId) {
    const record = this.jobs.get(taskId);
    if (!record) throw new Error(`Không tìm thấy Muse task ${taskId}`);
    if (record.status === "failed") {
      return { status: "failed", task_status: "failed", localFile: null, video_url: null, error: record.error };
    }
    if (record.status === "succeeded") {
      return { status: "succeeded", task_status: "succeeded", localFile: record.localFile, video_url: null };
    }
    if (Date.now() - record.startedAt > MAX_SCENE_WAIT_MS) {
      record.status = "failed";
      record.error = "Muse chưa hoàn tất trong 15 phút";
      return { status: "failed", task_status: "failed", localFile: null, video_url: null, error: record.error };
    }
    return { status: "processing", task_status: "processing", localFile: null, video_url: null };
  }
}

/**
 * Router chọn provider theo payload.provider ('muse' | 'seedance', mặc định seedance).
 * getTask định tuyến theo tiền tố taskId ('muse_' -> Muse) kèm bảng ghi nhớ.
 */
function createProviderRouter({ seedance, muse }) {
  if (!seedance) throw new Error("Provider router cần SeedanceProvider");
  const museTaskIds = new Set();
  return {
    name: "routing",
    async submit(payload) {
      if (payload && payload.provider === "muse") {
        if (!muse) throw new Error("Động cơ Muse chưa bật (MODOLIVIO_MUSE_ENGINE=1) hoặc chưa có phiên Muse");
        const out = await muse.submit(payload);
        museTaskIds.add(out.taskId);
        return out;
      }
      return seedance.submit(payload);
    },
    async getTask(taskId) {
      if (muse && (museTaskIds.has(taskId) || String(taskId).startsWith("muse_"))) {
        return muse.getTask(taskId);
      }
      return seedance.getTask(taskId);
    },
  };
}

module.exports = { MuseProvider, createProviderRouter, FACE_LOCK_MIN };
