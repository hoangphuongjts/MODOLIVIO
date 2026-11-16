// @ts-nocheck - File bien dich tu TypeScript cua Gemini (tsc, CommonJS); da typecheck strict o dang .ts goc, khong typecheck lai bang --checkJs.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MusePlaywrightEngine = exports.ManagedChromeCdpLauncher = exports.HumanBehaviorDriver = exports.MuseAccountPoolGuard = exports.FileBackedWalStore = exports.SuspectDieError = exports.HardGateValidationError = exports.DEFAULT_HUMANIZE_CONFIG = exports.P3_ENGINE_CONSTANTS = void 0;
exports.isPortFree = isPortFree;
exports.findAvailablePort = findAvailablePort;
exports.validateMuseJobHardGate = validateMuseJobHardGate;
// src/modules/engine/museCdpEngine.ts
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const net = __importStar(require("node:net"));
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const node_child_process_1 = require("node:child_process");
// Load Playwright only when opening a real CDP session; offline unit tests must
// not require a browser installation or a logged-in Muse session.
const playwright_1 = { get chromium() { return require("playwright").chromium; } };
/** Ràng buộc cứng MODOLIVIO P3 v3 */
exports.P3_ENGINE_CONSTANTS = {
    BRIDGE_PORT_RANGE: [19740, 19749],
    CDP_PORT_RANGE: [19750, 19759],
    MAX_CONCURRENT_JOBS: 1, // Bắt buộc 1 job tuần tự chống tràn RAM 8GB
    MAX_SCENES: 20,
    DEFAULT_SCENE_DURATION_SEC: 10,
    MIN_SCENE_DURATION_SEC: 5,
    MAX_SCENE_DURATION_SEC: 10,
    MIN_FACE_LOCK: 0.95, // >= 95%
    MAX_PRICE_TAG_SEC: 3, // Tem giá tối đa 3 giây trên khung sản phẩm
    TOKEN_TTL_SEC: 3600, // 60 phút
    TOKEN_REFRESH_THRESHOLD_SEC: 300, // Còn < 5 phút thì silent refresh
    HEARTBEAT_INTERVAL_MS: 5000, // 5s/lần
    CLOUD_FALLBACK_TIMEOUT_MS: 15000, // Mất heartbeat > 15s -> Cloud Fallback
    SUSPECT_DIE_COOLDOWN_MS: 24 * 60 * 60 * 1000, // Khóa mềm 24h nếu dính SUSPECT_DIE
    MAX_RELOGIN_PER_12H: 1, // Chặn vòng lặp đăng nhập lại gây khóa acc
    DEFAULT_DAILY_SCENE_CAP: 50,
};
exports.DEFAULT_HUMANIZE_CONFIG = {
    enabled: true,
    minInterSceneJitterMs: 8000,
    maxInterSceneJitterMs: 18000,
    minPostJobCooldownMs: 180000,
    maxPostJobCooldownMs: 420000,
    typingDelayMinMs: 25,
    typingDelayMaxMs: 65,
};
/**
 * SELECTOR THẬT của muse.ai — lấy từ source Muse Studio 1.2.0 (engine.js) mà team đã đọc.
 * QUAN TRỌNG: muse.ai là GIAO DIỆN CHAT, không phải "studio" có nút bấm riêng.
 * Các data-testid dạng "studio-workspace", "scene-prompt-input", "generate-scene-btn",
 * "upload-character-ref"... là Gemini ĐOÁN, KHÔNG tồn tại trên muse.ai thật.
 * GPT2 phải xác minh lại toàn bộ các selector dưới đây bằng CDP trên Chrome thật
 * (nhiệm vụ Bridge Agent + CDP) trước khi chạy job thật đầu tiên.
 */
exports.MUSE_CHAT_SELECTORS = {
    /** Ô nhập chat (composer) — textarea */
    composer: 'textarea',
    /** Hiện khi CHƯA đăng nhập */
    notLoggedInPane: '[data-testid="native-auth-access-pane"]',
    /** Panel trạng thái khi job đang chạy */
    statusPanel: '[data-testid="hatch-status-panel-sliding-surface"]',
    /** Nút Stop — hiện khi job đang chạy, mất khi job xong */
    stopButton: '[data-testid="hatch-composer-stop-button"]',
    /** Ảnh đính kèm đã lên chat (prefix) */
    attachmentPresentation: '[data-testid^="hatch-chat-attachment-presentation-"]',
    /** Bong bóng tin nhắn của agent */
    agentBubble: '.hatch-agent-bubble-bg',
    /** Input file ẩn trong composer (đính kèm ảnh) */
    fileInput: 'input[type="file"]',
    /** Video trong bong bóng agent */
    videoInBubble: '.hatch-agent-bubble-bg video',
};
class HardGateValidationError extends Error {
    errors;
    statusCode = 422;
    constructor(errors) {
        super(`Hard-Gate 422: ${errors.join(' | ')}`);
        this.errors = errors;
        this.name = 'HardGateValidationError';
    }
}
exports.HardGateValidationError = HardGateValidationError;
class SuspectDieError extends Error {
    accountId;
    code;
    constructor(accountId, code, message) {
        super(message);
        this.accountId = accountId;
        this.code = code;
        this.name = 'SuspectDieError';
    }
}
exports.SuspectDieError = SuspectDieError;
function randomInt(min, max) {
    if (max <= min)
        return min;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function sleep(ms) {
    if (ms <= 0)
        return Promise.resolve();
    return new Promise((r) => setTimeout(r, ms));
}
/** Kiểm tra cổng TCP rảnh trên 127.0.0.1 */
function isPortFree(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => server.close(() => resolve(true)));
        server.listen(port, '127.0.0.1');
    });
}
/** Tìm cổng tự nhảy trong dải [minPort..maxPort] */
async function findAvailablePort(minPort, maxPort) {
    for (let port = minPort; port <= maxPort; port++) {
        if (await isPortFree(port))
            return port;
    }
    throw new Error(`Không còn cổng trống trong dải ${minPort}–${maxPort}`);
}
/** Hard-Gate 422: Chặn ngay tại cửa ngõ nếu vi phạm quy tắc cứng MODOLIVIO */
function validateMuseJobHardGate(job) {
    const errors = [];
    if (job.bridgePort < exports.P3_ENGINE_CONSTANTS.BRIDGE_PORT_RANGE[0] ||
        job.bridgePort > exports.P3_ENGINE_CONSTANTS.BRIDGE_PORT_RANGE[1]) {
        errors.push(`bridgePort phải thuộc 19740–19749 (nhận được: ${job.bridgePort})`);
    }
    if (!job.compliancePassed) {
        errors.push('Payload chưa qua Precheck từ cấm (compliancePassed !== true)');
    }
    if (!job.scenes.length || job.scenes.length > exports.P3_ENGINE_CONSTANTS.MAX_SCENES) {
        errors.push(`Số cảnh phải từ 1 đến ${exports.P3_ENGINE_CONSTANTS.MAX_SCENES} (nhận được: ${job.scenes.length})`);
    }
    const numericPriceRegex = /\b\d+(?:[.,]\d+)?\s?(?:k|nghìn|ngàn|đ|đồng|vnđ|vnd|cành|củ|triệu)\b/i;
    for (const s of job.scenes) {
        if (s.durationSec < exports.P3_ENGINE_CONSTANTS.MIN_SCENE_DURATION_SEC ||
            s.durationSec > exports.P3_ENGINE_CONSTANTS.MAX_SCENE_DURATION_SEC) {
            errors.push(`Cảnh #${s.sceneIndex}: Thời lượng ${s.durationSec}s ngoài dải 5–10s`);
        }
        if (s.hasMC && s.faceLockSimilarity < exports.P3_ENGINE_CONSTANTS.MIN_FACE_LOCK) {
            errors.push(`Cảnh #${s.sceneIndex}: Face Lock ${(s.faceLockSimilarity * 100).toFixed(0)}% < 95%`);
        }
        if (!s.preserveOriginalProductImage) {
            errors.push(`Cảnh #${s.sceneIndex}: Bắt buộc preserveOriginalProductImage = true`);
        }
        if ((s.priceTagOverlaySec ?? 0) > exports.P3_ENGINE_CONSTANTS.MAX_PRICE_TAG_SEC) {
            errors.push(`Cảnh #${s.sceneIndex}: Tem giá ${s.priceTagOverlaySec}s > 3s tối đa`);
        }
        if (numericPriceRegex.test(s.voiceText)) {
            errors.push(`Cảnh #${s.sceneIndex}: Lời thoại chứa giá dạng số bị cấm`);
        }
    }
    if (errors.length > 0) {
        throw new HardGateValidationError(errors);
    }
}
class FileBackedWalStore {
    accounts = new Map();
    checkpoints = new Map();
    auditLogs = [];
    walFilePath;
    constructor(storageDir, initialAccounts = []) {
        fs.mkdirSync(storageDir, { recursive: true });
        this.walFilePath = path.join(storageDir, 'p3_state_wal.json');
        if (fs.existsSync(this.walFilePath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(this.walFilePath, 'utf8'));
                for (const acc of parsed.accounts || [])
                    this.accounts.set(acc.accountId, acc);
                for (const cp of parsed.checkpoints || []) {
                    this.checkpoints.set(`${cp.jobId}:${cp.sceneIndex}`, cp);
                }
                this.auditLogs = parsed.auditLogs || [];
            }
            catch {
                // Bỏ qua nếu file WAL trống/hỏng ở lần khởi tạo đầu
            }
        }
        for (const acc of initialAccounts) {
            if (!this.accounts.has(acc.accountId)) {
                this.accounts.set(acc.accountId, acc);
            }
        }
        this.flushAtomic();
    }
    flushAtomic() {
        const tmpPath = `${this.walFilePath}.tmp`;
        const payload = JSON.stringify({
            journalMode: 'WAL',
            accounts: Array.from(this.accounts.values()),
            checkpoints: Array.from(this.checkpoints.values()),
            auditLogs: this.auditLogs.slice(-500),
        }, null, 2);
        fs.writeFileSync(tmpPath, payload, 'utf8');
        fs.renameSync(tmpPath, this.walFilePath);
    }
    upsertAccount(account) {
        this.accounts.set(account.accountId, { ...account });
        this.flushAtomic();
    }
    getAccount(accountId) {
        const found = this.accounts.get(accountId);
        return found ? { ...found } : undefined;
    }
    listAccounts() {
        return Array.from(this.accounts.values()).map((a) => ({ ...a }));
    }
    saveCheckpoint(record) {
        this.checkpoints.set(`${record.jobId}:${record.sceneIndex}`, { ...record });
        this.flushAtomic();
    }
    getCheckpoints(jobId) {
        return Array.from(this.checkpoints.values())
            .filter((c) => c.jobId === jobId)
            .sort((a, b) => a.sceneIndex - b.sceneIndex);
    }
    appendAuditLog(event) {
        this.auditLogs.push(event);
        this.flushAtomic();
    }
    getAuditLogs() {
        return [...this.auditLogs];
    }
}
exports.FileBackedWalStore = FileBackedWalStore;
/**
 * Bộ điều phối xoay vòng tài khoản + Proxy Sticky + Phát hiện SUSPECT_DIE + Circuit Breaker
 */
class MuseAccountPoolGuard {
    store;
    consecutiveSuspectDieCount = 0;
    circuitBreakerOpenUntilMs = 0;
    constructor(store) {
        this.store = store;
    }
    isCircuitBreakerOpen(nowMs = Date.now()) {
        return nowMs < this.circuitBreakerOpenUntilMs;
    }
    /** Chọn tài khoản ACTIVE theo LRU (giãn đều tải), kiểm tra cooldown & hạn mức ngày */
    acquireAccountForJob(scenesNeeded, preferredAccountId, nowMs = Date.now()) {
        if (this.isCircuitBreakerOpen(nowMs)) {
            throw new Error('CIRCUIT_BREAKER_OPEN: Hệ thống đang tạm ngắt Muse local để bảo vệ dàn tài khoản');
        }
        const all = this.store.listAccounts();
        // Khôi phục các tài khoản đã hết thời gian cooldown/suspect_die
        for (const acc of all) {
            if (acc.status !== 'ACTIVE' && acc.cooldownUntilMs > 0 && nowMs >= acc.cooldownUntilMs) {
                acc.status = 'ACTIVE';
                acc.cooldownUntilMs = 0;
                acc.suspectReason = undefined;
                this.store.upsertAccount(acc);
            }
        }
        const candidates = this.store
            .listAccounts()
            .filter((acc) => acc.status === 'ACTIVE' &&
            acc.cooldownUntilMs <= nowMs &&
            acc.dailyScenesUsed + scenesNeeded <= acc.dailyScenesLimit)
            .sort((a, b) => a.lastUsedAtMs - b.lastUsedAtMs); // Least Recently Used
        if (preferredAccountId) {
            const preferred = candidates.find((c) => c.accountId === preferredAccountId);
            if (preferred)
                return preferred;
        }
        if (!candidates.length) {
            throw new Error('NO_HEALTHY_ACCOUNT: Không còn tài khoản Muse ACTIVE khả dụng (đang cooldown hoặc SUSPECT_DIE)');
        }
        return candidates[0];
    }
    recordSceneSuccess(accountId, nowMs = Date.now()) {
        const acc = this.store.getAccount(accountId);
        if (!acc)
            return;
        acc.dailyScenesUsed += 1;
        acc.lastUsedAtMs = nowMs;
        this.consecutiveSuspectDieCount = 0;
        this.store.upsertAccount(acc);
    }
    applyPostJobCooldown(accountId, cooldownMs, nowMs = Date.now()) {
        const acc = this.store.getAccount(accountId);
        if (!acc || acc.status === 'SUSPECT_DIE')
            return;
        acc.status = 'COOLDOWN';
        acc.cooldownUntilMs = nowMs + cooldownMs;
        acc.lastUsedAtMs = nowMs;
        this.store.upsertAccount(acc);
    }
    canAttemptAutoRelogin(accountId, nowMs = Date.now()) {
        const acc = this.store.getAccount(accountId);
        if (!acc)
            return false;
        const twelveHoursMs = 12 * 60 * 60 * 1000;
        if (nowMs - acc.lastReloginAtMs > twelveHoursMs) {
            acc.reloginCount12h = 0;
            this.store.upsertAccount(acc);
        }
        return acc.reloginCount12h < exports.P3_ENGINE_CONSTANTS.MAX_RELOGIN_PER_12H;
    }
    markReloginAttempt(accountId, nowMs = Date.now()) {
        const acc = this.store.getAccount(accountId);
        if (!acc)
            return;
        acc.reloginCount12h += 1;
        acc.lastReloginAtMs = nowMs;
        this.store.upsertAccount(acc);
    }
    /** Đánh dấu SUSPECT_DIE ngay lập tức và mở Circuit Breaker nếu >= 2 tài khoản dính liên tiếp */
    markAccountSuspectDie(jobId, accountId, reason, onAlert, nowMs = Date.now()) {
        const acc = this.store.getAccount(accountId);
        if (acc) {
            acc.status = 'SUSPECT_DIE';
            acc.cooldownUntilMs = nowMs + exports.P3_ENGINE_CONSTANTS.SUSPECT_DIE_COOLDOWN_MS;
            acc.suspectReason = reason;
            this.store.upsertAccount(acc);
        }
        this.consecutiveSuspectDieCount += 1;
        const alertEv = {
            timestampMs: nowMs,
            jobId,
            accountId,
            level: 'CRITICAL',
            code: 'SUSPECT_DIE_TRIGGERED',
            detail: `Tài khoản ${accountId} chuyển SUSPECT_DIE (nghỉ 24h). Lý do: ${reason}`,
        };
        this.store.appendAuditLog(alertEv);
        onAlert(alertEv);
        if (this.consecutiveSuspectDieCount >= 2) {
            this.circuitBreakerOpenUntilMs = nowMs + 30 * 60 * 1000; // Ngắt mạch 30 phút
            const cbEv = {
                timestampMs: nowMs,
                jobId,
                accountId,
                level: 'CRITICAL',
                code: 'CIRCUIT_BREAKER_OPEN',
                detail: 'Phát hiện >= 2 tài khoản SUSPECT_DIE liên tiếp -> Mở Circuit Breaker, chuyển Cloud Fallback.',
            };
            this.store.appendAuditLog(cbEv);
            onAlert(cbEv);
        }
    }
}
exports.MuseAccountPoolGuard = MuseAccountPoolGuard;
/**
 * Nhân hóa tương tác người thật trên Playwright:
 * - Di chuyển chuột theo đường cong Bézier bậc 3 (không nhảy dịch chuyển tức thời)
 * - Gõ phím có nhịp ngẫu nhiên (typing cadence)
 */
class HumanBehaviorDriver {
    cfg;
    lastMouseX = 120;
    lastMouseY = 120;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async moveMouseCurvedTo(page, targetX, targetY) {
        if (!this.cfg.enabled) {
            await page.mouse.move(targetX, targetY);
            this.lastMouseX = targetX;
            this.lastMouseY = targetY;
            return;
        }
        const startX = this.lastMouseX;
        const startY = this.lastMouseY;
        const cp1X = startX + (targetX - startX) * 0.3 + randomInt(-45, 45);
        const cp1Y = startY + (targetY - startY) * 0.2 + randomInt(-35, 35);
        const cp2X = startX + (targetX - startX) * 0.7 + randomInt(-45, 45);
        const cp2Y = startY + (targetY - startY) * 0.8 + randomInt(-35, 35);
        const steps = randomInt(8, 14);
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const inv = 1 - t;
            const x = inv ** 3 * startX +
                3 * inv ** 2 * t * cp1X +
                3 * inv * t ** 2 * cp2X +
                t ** 3 * targetX;
            const y = inv ** 3 * startY +
                3 * inv ** 2 * t * cp1Y +
                3 * inv * t ** 2 * cp2Y +
                t ** 3 * targetY;
            await page.mouse.move(Math.round(x), Math.round(y));
            await sleep(randomInt(8, 22));
        }
        this.lastMouseX = targetX;
        this.lastMouseY = targetY;
    }
    async humanClick(page, selector) {
        const locator = page.locator(selector).first();
        const box = await locator.boundingBox();
        if (box) {
            const clickX = box.x + box.width * (0.3 + Math.random() * 0.4);
            const clickY = box.y + box.height * (0.3 + Math.random() * 0.4);
            await this.moveMouseCurvedTo(page, clickX, clickY);
            await sleep(randomInt(40, 110));
            await page.mouse.down();
            await sleep(randomInt(35, 85));
            await page.mouse.up();
        }
        else {
            await locator.click();
        }
    }
    async humanType(page, selector, text) {
        await this.humanClick(page, selector);
        await page.fill(selector, '');
        if (!this.cfg.enabled) {
            await page.fill(selector, text);
            return;
        }
        for (const ch of text) {
            await page.keyboard.type(ch, {
                delay: randomInt(this.cfg.typingDelayMinMs, this.cfg.typingDelayMaxMs),
            });
        }
    }
}
exports.HumanBehaviorDriver = HumanBehaviorDriver;
/**
 * Managed Chrome Launcher:
 * - Cô lập thư mục Profile theo accountId (Vanzo Profile Isolation)
 * - Gắn Proxy Sticky riêng cho từng accountId
 * - Mở CDP trên dải cổng động 19750–19759
 */
class ManagedChromeCdpLauncher {
    executablePath;
    baseProfileDir;
    chromeProc = null;
    browser = null;
    activeCdpPort = null;
    constructor(executablePath, baseProfileDir = path.join(process.env.LOCALAPPDATA || '/tmp', 'MODOLIVIO', 'Profiles')) {
        this.executablePath = executablePath;
        this.baseProfileDir = baseProfileDir;
    }
    resolveChromeBinary() {
        if (this.executablePath && fs.existsSync(this.executablePath)) {
            return this.executablePath;
        }
        const candidates = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
        ];
        for (const p of candidates) {
            if (fs.existsSync(p))
                return p;
        }
        return playwright_1.chromium.executablePath();
    }
    async launchForAccount(account) {
        const cdpPort = await findAvailablePort(exports.P3_ENGINE_CONSTANTS.CDP_PORT_RANGE[0], exports.P3_ENGINE_CONSTANTS.CDP_PORT_RANGE[1]);
        const safeAccountFolder = account.accountId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const profileDir = path.join(this.baseProfileDir, safeAccountFolder);
        fs.mkdirSync(profileDir, { recursive: true });
        const binary = this.resolveChromeBinary();
        const args = [
            `--remote-debugging-port=${cdpPort}`,
            `--user-data-dir=${profileDir}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
            `--window-size=${account.viewport.width},${account.viewport.height}`,
        ];
        // [BỔ SUNG KHI TÍCH HỢP — Annie] Chế độ headless cho môi trường không có màn
        // hình (Linux/CI/kiểm thử): MODOLIVIO_CHROME_HEADLESS=1 thêm các cờ cần
        // thiết để Chrome chạy được khi không có X và khi chạy dưới quyền root.
        // Mặc định trên Windows của người dùng KHÔNG bật (cần cửa sổ Chrome hiện
        // ra để đăng nhập Muse bằng tay).
        if (process.env.MODOLIVIO_CHROME_HEADLESS === '1') {
            args.push('--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage');
        }
        // Gắn Proxy Sticky cố định theo từng tài khoản (IP không nhảy loạn giữa các phiên)
        if (account.proxy?.server) {
            args.push(`--proxy-server=${account.proxy.server}`);
        }
        this.chromeProc = (0, node_child_process_1.spawn)(binary, args, {
            stdio: 'ignore',
            detached: false,
        });
        const endpointUrl = `http://127.0.0.1:${cdpPort}`;
        await this.waitForCdpReady(endpointUrl, 12000);
        this.browser = await playwright_1.chromium.connectOverCDP(endpointUrl);
        this.activeCdpPort = cdpPort;
        return { browser: this.browser, cdpPort };
    }
    waitForCdpReady(endpointUrl, timeoutMs) {
        const start = Date.now();
        return new Promise((resolve, reject) => {
            const check = () => {
                http
                    .get(`${endpointUrl}/json/version`, (res) => {
                    res.resume();
                    if (res.statusCode === 200)
                        return resolve();
                    retry();
                })
                    .on('error', retry);
            };
            const retry = () => {
                if (Date.now() - start > timeoutMs) {
                    return reject(new Error(`Timeout chờ CDP sẵn sàng tại ${endpointUrl}`));
                }
                setTimeout(check, 250);
            };
            check();
        });
    }
    async close() {
        try {
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
            }
        }
        finally {
            if (this.chromeProc && !this.chromeProc.killed) {
                this.chromeProc.kill('SIGTERM');
                this.chromeProc = null;
            }
            this.activeCdpPort = null;
        }
    }
}
exports.ManagedChromeCdpLauncher = ManagedChromeCdpLauncher;
/**
 * Lõi động cơ MusePlaywrightEngine (P3 v3):
 * - Concurrency = 1 (1 job tuần tự)
 * - Xoay tài khoản + Proxy sticky + Phát hiện SUSPECT_DIE + Circuit Breaker
 * - Pipeline Playwright 4 bước + Nhân hóa chuột/phím/jitter
 */
class MusePlaywrightEngine {
    store;
    poolGuard;
    callbacks;
    isJobRunning = false; // Khóa cứng 1 job tuần tự
    humanCfg;
    driver;
    constructor(store, poolGuard, callbacks) {
        this.store = store;
        this.poolGuard = poolGuard;
        this.callbacks = callbacks;
        this.humanCfg = {
            ...exports.DEFAULT_HUMANIZE_CONFIG,
            ...(callbacks.humanizeConfig || {}),
        };
        this.driver = new HumanBehaviorDriver(this.humanCfg);
    }
    async executeJob(job) {
        // 1. Hard-Gate 422
        validateMuseJobHardGate(job);
        // 2. Chặn chạy song song > 1 job
        if (this.isJobRunning) {
            throw new Error('ENGINE_BUSY: Chỉ cho phép 1 job render tuần tự (Concurrency = 1)');
        }
        this.isJobRunning = true;
        const cacheDir = path.join(this.callbacks.baseCacheDir || path.join(process.env.LOCALAPPDATA || '/tmp', 'MODOLIVIO', 'Cache'), job.jobId);
        fs.mkdirSync(cacheDir, { recursive: true });
        let currentToken = job.scopedToken;
        let currentTokenExpiry = job.tokenExpiresAtMs;
        let lastHeartbeatAckMs = Date.now();
        let currentStep = 'INIT';
        let currentPercent = 0;
        const heartbeatTimer = setInterval(() => {
            try {
                this.callbacks.onHeartbeat(job.jobId, currentStep, currentPercent);
                lastHeartbeatAckMs = Date.now();
            }
            catch {
                // Sẽ bắt ở mốc kiểm tra 15s
            }
        }, exports.P3_ENGINE_CONSTANTS.HEARTBEAT_INTERVAL_MS);
        let activeAccount = null;
        let launcher = null;
        try {
            // Cho phép tối đa 1 lần xoay sang tài khoản dự phòng nếu tài khoản đầu dính SUSPECT_DIE
            for (let accountAttempt = 0; accountAttempt < 2; accountAttempt++) {
                activeAccount = this.poolGuard.acquireAccountForJob(job.scenes.length, accountAttempt === 0 ? job.preferredAccountId : undefined);
                this.emitAudit({
                    timestampMs: Date.now(),
                    jobId: job.jobId,
                    accountId: activeAccount.accountId,
                    level: 'INFO',
                    code: accountAttempt === 0 ? 'ACCOUNT_SELECTED' : 'ACCOUNT_ROTATED',
                    detail: `Sử dụng profile ${activeAccount.accountId} (Proxy: ${activeAccount.proxy?.server || 'DIRECT'})`,
                });
                launcher = new ManagedChromeCdpLauncher(this.callbacks.chromeExecutablePath, this.callbacks.baseProfileDir);
                try {
                    const { browser, cdpPort } = await launcher.launchForAccount(activeAccount);
                    const context = browser.contexts()[0] || (await browser.newContext());
                    // Ẩn dấu vết automation cơ bản trên trình duyệt
                    await context.addInitScript(() => {
                        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    });
                    const page = context.pages()[0] || (await context.newPage());
                    await page.setViewportSize(activeAccount.viewport);
                    let latestNetworkAnomaly = null;
                    // Interceptor bắt 401/403/429 & dấu hiệu SUSPECT_DIE
                    page.on('response', async (res) => {
                        const status = res.status();
                        const url = res.url();
                        if (status === 401 || status === 403 || status === 429) {
                            let snippet = '';
                            try {
                                snippet = (await res.text()).slice(0, 200).toLowerCase();
                            }
                            catch {
                                snippet = '';
                            }
                            latestNetworkAnomaly = { status, url, bodySnippet: snippet };
                        }
                    });
                    const museBaseUrl = this.callbacks.museBaseUrl || 'https://muse.ai';
                    // =====================================================================
                    // BƯỚC 1: XÁC MINH PHIÊN MUSE ĐÃ ĐĂNG NHẬP + PHÁT HIỆN SUSPECT_DIE
                    // =====================================================================
                    currentStep = 'STEP_1_VERIFY_SESSION';
                    currentPercent = 10;
                    this.callbacks.onHeartbeat(job.jobId, currentStep, currentPercent);
                    await this.ensureAuthenticatedSession(job, activeAccount, page, museBaseUrl, cdpPort, () => latestNetworkAnomaly, () => {
                        latestNetworkAnomaly = null;
                    });
                    // =====================================================================
                    // BƯỚC 2: BƠM ẢNH NHÂN VẬT + ẢNH SẢN PHẨM GỐC & KHÓA FACE LOCK >= 95%
                    // =====================================================================
                    // BƯỚC 2 (chat): đính kèm ảnh nhân vật + ảnh sản phẩm gốc vào composer.
                    // Face Lock >= 95% đã được Hard-Gate kiểm tra từ job payload (validateMuseJobHardGate),
                    // KHÔNG có ô nhập threshold trên muse.ai. (XÁC MINH DOM THẬT — GPT2/CDP)
                    currentStep = 'STEP_2_UPLOAD_ANCHORS';
                    currentPercent = 25;
                    this.callbacks.onHeartbeat(job.jobId, currentStep, currentPercent);
                    await this.attachFilesToComposer(page, [job.characterRefImagePath, job.originalProductImagePath]);
                    await page.waitForSelector(exports.MUSE_CHAT_SELECTORS.attachmentPresentation, { timeout: 15000 });
                    this.throwIfSuspectDie(activeAccount.accountId, page, latestNetworkAnomaly);
                    // =====================================================================
                    // BƯỚC 3 & 4: CHẠY TUẦN TỰ TỪNG CẢNH + JITTER + POLL + TẢI MP4 CHECKPOINT
                    // =====================================================================
                    for (let i = 0; i < job.scenes.length; i++) {
                        const scene = job.scenes[i];
                        const existing = this.store
                            .getCheckpoints(job.jobId)
                            .find((c) => c.sceneIndex === scene.sceneIndex);
                        if (existing?.status === 'RENDERED' && existing.localMp4Path && fs.existsSync(existing.localMp4Path)) {
                            continue; // Bỏ qua cảnh đã xong (Crash Recovery)
                        }
                        if (Date.now() - lastHeartbeatAckMs > exports.P3_ENGINE_CONSTANTS.CLOUD_FALLBACK_TIMEOUT_MS) {
                            throw new Error('HEARTBEAT_LOST_15S');
                        }
                        // Silent Refresh Token 60 phút nếu còn < 5 phút
                        if (currentTokenExpiry - Date.now() <= exports.P3_ENGINE_CONSTANTS.TOKEN_REFRESH_THRESHOLD_SEC * 1000) {
                            const refreshed = await this.callbacks.onSilentRefreshToken(job.jobId, currentToken);
                            currentToken = refreshed.token;
                            currentTokenExpiry = refreshed.expiresAtMs;
                        }
                        // Giãn nhịp ngẫu nhiên (Jitter) giữa các cảnh để chống quét tốc độ
                        if (i > 0 && this.humanCfg.enabled) {
                            await sleep(randomInt(this.humanCfg.minInterSceneJitterMs, this.humanCfg.maxInterSceneJitterMs));
                        }
                        currentStep = `STEP_3_RENDER_SCENE_${scene.sceneIndex}_OF_${job.scenes.length}`;
                        currentPercent = 25 + Math.round(((i + 0.3) / job.scenes.length) * 65);
                        this.callbacks.onHeartbeat(job.jobId, currentStep, currentPercent);
                        lastHeartbeatAckMs = Date.now();
                        latestNetworkAnomaly = null;
                        const chatPrompt = this.buildSceneChatPrompt(scene);
                        await this.driver.humanType(page, exports.MUSE_CHAT_SELECTORS.composer, chatPrompt);
                        await page.keyboard.press('Enter');
                        const mp4Url = await this.pollSceneUntilDone(page, scene.sceneIndex, () => {
                            this.throwIfSuspectDie(activeAccount.accountId, page, latestNetworkAnomaly);
                        });
                        currentStep = `STEP_4_DOWNLOAD_SCENE_${scene.sceneIndex}`;
                        const localMp4Path = path.join(cacheDir, `scene_${scene.sceneIndex}.mp4`);
                        await this.downloadFileToLocal(mp4Url, localMp4Path);
                        const record = {
                            jobId: job.jobId,
                            sceneIndex: scene.sceneIndex,
                            accountId: activeAccount.accountId,
                            status: 'RENDERED',
                            localMp4Path,
                            updatedAt: Date.now(),
                        };
                        this.store.saveCheckpoint(record);
                        this.callbacks.onCheckpointSave(record);
                        this.poolGuard.recordSceneSuccess(activeAccount.accountId);
                    }
                    // Áp dụng cooldown giãn nhịp sau khi hoàn thành job
                    if (this.humanCfg.enabled) {
                        const cooldownMs = randomInt(this.humanCfg.minPostJobCooldownMs, this.humanCfg.maxPostJobCooldownMs);
                        this.poolGuard.applyPostJobCooldown(activeAccount.accountId, cooldownMs);
                    }
                    currentStep = 'COMPLETED';
                    currentPercent = 100;
                    this.callbacks.onHeartbeat(job.jobId, currentStep, currentPercent);
                    return this.store.getCheckpoints(job.jobId);
                }
                catch (innerErr) {
                    if (innerErr instanceof SuspectDieError && activeAccount) {
                        this.poolGuard.markAccountSuspectDie(job.jobId, activeAccount.accountId, innerErr.message, (ev) => this.callbacks.onSecurityAlert(ev));
                        await launcher.close();
                        launcher = null;
                        // Nếu Circuit Breaker chưa mở và còn lượt xoay tài khoản -> thử sang tài khoản tiếp theo
                        if (!this.poolGuard.isCircuitBreakerOpen() && accountAttempt === 0) {
                            continue;
                        }
                    }
                    throw innerErr;
                }
            }
            throw new Error('EXHAUSTED_ACCOUNT_ROTATION');
        }
        catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            await this.callbacks.onTriggerCloudFallback(job.jobId, reason, this.store.getCheckpoints(job.jobId));
            throw err;
        }
        finally {
            clearInterval(heartbeatTimer);
            if (launcher) {
                await launcher.close();
            }
            this.isJobRunning = false;
        }
    }
    emitAudit(event) {
        this.store.appendAuditLog(event);
        this.callbacks.onSecurityAlert(event);
    }
    /** Kiểm tra dấu hiệu SUSPECT_DIE từ mã mạng 429/403 hoặc URL challenge/suspended */
    throwIfSuspectDie(accountId, page, anomaly) {
        const currentUrl = page.url().toLowerCase();
        if (currentUrl.includes('/suspended') ||
            currentUrl.includes('/challenge') ||
            currentUrl.includes('/checkpoint')) {
            throw new SuspectDieError(accountId, 'URL_CHALLENGE', `Phát hiện trang khóa/xác minh: ${currentUrl}`);
        }
        if (!anomaly)
            return;
        if (anomaly.status === 429 ||
            anomaly.bodySnippet.includes('rate_limit') ||
            anomaly.bodySnippet.includes('unusual_activity') ||
            anomaly.bodySnippet.includes('suspended')) {
            throw new SuspectDieError(accountId, `HTTP_${anomaly.status}`, `Muse API cảnh báo bất thường (${anomaly.status}) tại ${anomaly.url}`);
        }
    }
    /** Xác minh phiên đã đăng nhập trên GIAO DIỆN CHAT muse.ai; nếu dính 401/403 chỉ cho phép Auto-Relogin tối đa 1 lần / 12h.
     * Selector thật: chưa đăng nhập = [data-testid="native-auth-access-pane"] hiện;
     * đã đăng nhập = composer textarea hiện và pane kia vắng. (XÁC MINH DOM THẬT — GPT2/CDP) */
    async ensureAuthenticatedSession(job, account, page, museBaseUrl, cdpPort, getAnomaly, resetAnomaly) {
        resetAnomaly();
        await page.goto(`${museBaseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        this.throwIfSuspectDie(account.accountId, page, getAnomaly());
        const checkLoggedIn = async () => page.evaluate((sel) => {
            const pane = document.querySelector(sel.notLoggedInPane);
            const composer = document.querySelector(sel.composer);
            return !pane && Boolean(composer);
        }, exports.MUSE_CHAT_SELECTORS);
        if ((await checkLoggedIn()) && !page.url().includes('/login') && !getAnomaly()) {
            return;
        }
        this.emitAudit({
            timestampMs: Date.now(),
            jobId: job.jobId,
            accountId: account.accountId,
            level: 'WARN',
            code: 'HTTP_401_403_DETECTED',
            detail: `Phiên tài khoản ${account.accountId} hết hạn (401/403), kiểm tra điều kiện khôi phục phiên.`,
        });
        if (!this.poolGuard.canAttemptAutoRelogin(account.accountId)) {
            throw new SuspectDieError(account.accountId, 'RELOGIN_LOOP_GUARD', 'Vượt ngưỡng Auto-Relogin 1 lần/12h -> Chuyển SUSPECT_DIE để chống khóa vĩnh viễn');
        }
        this.poolGuard.markReloginAttempt(account.accountId);
        this.callbacks.onActionRequired(job.jobId, account.accountId, 'MUSE_401_403_RELOGIN', cdpPort);
        resetAnomaly();
        // Không có endpoint /auto-relogin trên muse.ai thật — người dùng đăng nhập tay trong
        // cửa sổ Chrome hiện ra (headed), engine chờ tối đa 5 phút rồi kiểm tra lại phiên.
        const reloginDeadline = Date.now() + 5 * 60 * 1000;
        while (Date.now() < reloginDeadline) {
            await sleep(5000);
            this.throwIfSuspectDie(account.accountId, page, getAnomaly());
            if ((await checkLoggedIn()) && !getAnomaly()) {
                return;
            }
        }
        throw new SuspectDieError(account.accountId, 'RELOGIN_FAILED', 'Không thể khôi phục phiên sau Auto-Relogin -> Chuyển SUSPECT_DIE');
    }
    /** Poll theo mô hình chat: job đang chạy = nút Stop hiện; xong = nút Stop mất + bong bóng agent có video.
     * Timeout mặc định 10 phút (video Muse 68–138s/cảnh theo đo thực tế). (XÁC MINH DOM THẬT — GPT2/CDP) */
    async pollSceneUntilDone(page, sceneIndex, onTickGuard, timeoutMs = 600000) {
        const start = Date.now();
        let sawRunning = false;
        while (Date.now() - start < timeoutMs) {
            onTickGuard();
            const state = await page.evaluate((sel) => {
                const stopBtn = document.querySelector(sel.stopButton);
                const running = Boolean(stopBtn);
                let mp4Url = '';
                if (!running) {
                    const bubbles = Array.from(document.querySelectorAll(sel.agentBubble));
                    const last = bubbles[bubbles.length - 1];
                    const video = last?.querySelector('video');
                    mp4Url = video?.getAttribute('src') || video?.querySelector('source')?.getAttribute('src') || '';
                    if (!mp4Url) {
                        const link = last?.querySelector('a[href$=".mp4"], a[download]');
                        mp4Url = link?.getAttribute('href') || '';
                    }
                }
                return { running, mp4Url };
            }, exports.MUSE_CHAT_SELECTORS);
            if (state.running)
                sawRunning = true;
            if (sawRunning && !state.running && state.mp4Url)
                return state.mp4Url;
            if (sawRunning && !state.running && !state.mp4Url && Date.now() - start > 60000) {
                throw new Error(`Muse.ai dừng mà không trả video tại cảnh #${sceneIndex} (có thể bị từ chối nội dung)`);
            }
            await sleep(2000);
        }
        throw new Error(`Timeout poll tiến độ cảnh #${sceneIndex}`);
    }
    /** Ghép prompt chat cho 1 cảnh: mô tả hình ảnh + thời lượng + lời thoại + khóa mặt/sản phẩm.
     * Không nhắc giá (Hard-Gate đã chặn giá dạng số trong voiceText). */
    buildSceneChatPrompt(scene) {
        const lines = [
            `Tạo video dọc 9:16, dài ${scene.durationSec} giây.`,
            scene.visualPrompt,
        ];
        if (scene.voiceText) {
            lines.push(`Lời thoại (nói tự nhiên như người bán thật, không đọc máy móc): "${scene.voiceText}"`);
        }
        if (scene.hasMC) {
            lines.push('Giữ nguyên khuôn mặt nhân vật trong ảnh đính kèm (face lock), không đổi mặt, không đổi người.');
        }
        if (scene.preserveOriginalProductImage) {
            lines.push('Giữ nguyên sản phẩm trong ảnh đính kèm: đúng màu, đúng hình dáng, đúng bao bì, đúng kích thước thật so với tay.');
        }
        lines.push('Không chèn chữ, logo, phụ đề hay giá lên hình.');
        return lines.join('\n');
    }
    /** Đính kèm nhiều file vào composer chat qua input[type="file"]. (XÁC MINH DOM THẬT — GPT2/CDP) */
    async attachFilesToComposer(page, filePaths) {
        const sel = exports.MUSE_CHAT_SELECTORS.fileInput;
        const input = page.locator(sel).first();
        await input.setInputFiles(filePaths.filter(Boolean));
        await sleep(randomInt(500, 1200));
    }
    downloadFileToLocal(fileUrl, destPath) {
        const client = fileUrl.startsWith('https') ? https : http;
        return new Promise((resolve, reject) => {
            client
                .get(fileUrl, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`Tải MP4 thất bại, HTTP ${res.statusCode}`));
                }
                const out = fs.createWriteStream(destPath);
                res.pipe(out);
                out.on('finish', () => out.close(() => resolve()));
                out.on('error', reject);
            })
                .on('error', reject);
        });
    }
}
exports.MusePlaywrightEngine = MusePlaywrightEngine;
