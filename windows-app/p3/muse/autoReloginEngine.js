// @ts-nocheck - File bien dich tu TypeScript cua Gemini (tsc, CommonJS); da typecheck strict o dang .ts goc, khong typecheck lai bang --checkJs.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoReloginEngine = exports.MUSE_AUTH_RULES = void 0;
exports.detectMuseAuthBlock = detectMuseAuthBlock;
const events_1 = __importDefault(require("events"));
const museSessionVault_1 = require("./museSessionVault");
// ==========================================
// 1. CẤU HÌNH & QUY TẮC CỨNG
// ==========================================
exports.MUSE_AUTH_RULES = {
    MUSE_BASE_URL: 'https://muse.ai',
    MUSE_LOGIN_URL: 'https://muse.ai/login',
    MUSE_HEALTH_ENDPOINT: 'https://muse.ai/api/v1/user/profile',
    MAX_RELOGIN_ATTEMPTS: 2, // Tự đăng nhập lại tối đa 2 lần
    STEP_TIMEOUT_MS: 45_000, // Timeout cứng 45 giây/bước
    HEARTBEAT_INTERVAL_MS: 15 * 60_000, // Kiểm tra sức khỏe phiên mỗi 15 phút
};
// ==========================================
// 2. BỘ PHÁT HIỆN SỚM 401/403/LOGIN/CAPTCHA
// ==========================================
function detectMuseAuthBlock(probe) {
    const lowerUrl = (probe.finalUrl || '').toLowerCase();
    const lowerBody = (probe.bodySnippet || '').slice(0, 5000).toLowerCase();
    if (lowerBody.includes('account suspended') ||
        lowerBody.includes('account has been banned') ||
        lowerBody.includes('tài khoản bị khóa')) {
        return 'ACCOUNT_SUSPENDED';
    }
    if (lowerBody.includes('g-recaptcha') ||
        lowerBody.includes('hcaptcha') ||
        lowerBody.includes('cf-turnstile') ||
        lowerBody.includes('verify you are human') ||
        lowerUrl.includes('/challenge')) {
        return 'CAPTCHA_REQUIRED';
    }
    if (probe.statusCode === 401 || probe.statusCode === 403) {
        return 'HTTP_401_403';
    }
    if (lowerUrl.includes('/login') ||
        lowerUrl.includes('/signin') ||
        lowerBody.includes('sign in to muse') ||
        lowerBody.includes('login required')) {
        return 'LOGIN_REDIRECT';
    }
    return 'NONE';
}
// ==========================================
// 3. ENGINE QUẢN LÝ PHIÊN MUSE, NẠP COOKIE EXTENSION & AUTO-RELOGIN
// ==========================================
class AutoReloginEngine extends events_1.default {
    vault;
    driver;
    inFlightRelogins = new Map();
    heartbeatTimer = null;
    constructor(vault, driver) {
        super();
        this.vault = vault;
        this.driver = driver;
    }
    /**
     * Luồng nhận cookie HttpOnly từ Companion Extension -> Nạp vào partition persist:mo-muse-<profileId>
     * -> Kiểm tra phiên sống ngay lập tức.
     */
    async hydrateSessionFromExtension(envelope) {
        const { importedCount, httpOnlyCount } = this.vault.importCookiesFromExtension(envelope);
        const partition = museSessionVault_1.MuseSessionVault.getPartitionName(envelope.profileId);
        const activeProxy = this.vault.getActiveProxy(envelope.profileId);
        if (activeProxy) {
            await this.driver.applyProxy(partition, activeProxy);
        }
        const cookieStore = this.driver.getCookieStore(partition);
        const injectedCookies = await this.vault.injectCookiesIntoPartition(envelope.profileId, cookieStore);
        const health = await this.checkSessionHealth(envelope.profileId);
        if (health.healthy) {
            return {
                healthy: true,
                injectedCookies,
                status: 'HEALTHY',
                messageVi: `Đã nạp ${injectedCookies}/${importedCount} cookie (${httpOnlyCount} HttpOnly) vào ${partition}. Phiên Muse đang hoạt động tốt.`,
            };
        }
        return {
            healthy: false,
            injectedCookies,
            status: health.status,
            messageVi: `Đã nạp cookie nhưng phiên Muse chưa hợp lệ (${health.blockReason}). Cần đăng nhập lại.`,
        };
    }
    /**
     * Kiểm tra sức khỏe phiên trước khi tạo video hoặc theo nhịp Heartbeat 15 phút
     */
    async checkSessionHealth(profileId) {
        const profile = this.vault.getProfile(profileId);
        if (!profile) {
            return { healthy: false, status: 'REAUTH_NEEDED', blockReason: 'LOGIN_REDIRECT' };
        }
        if (profile.status === 'SUSPENDED') {
            return { healthy: false, status: 'SUSPENDED', blockReason: 'ACCOUNT_SUSPENDED' };
        }
        const partition = museSessionVault_1.MuseSessionVault.getPartitionName(profileId);
        const activeProxy = this.vault.getActiveProxy(profileId);
        if (activeProxy) {
            await this.driver.applyProxy(partition, activeProxy);
        }
        try {
            const probe = await this.driver.probeSession(partition, exports.MUSE_AUTH_RULES.MUSE_HEALTH_ENDPOINT);
            const blockReason = detectMuseAuthBlock(probe);
            if (blockReason === 'NONE' && probe.statusCode >= 200 && probe.statusCode < 300) {
                this.vault.updateHealthStatus(profileId, 'HEALTHY');
                this.emit('healthChanged', { profileId, status: 'HEALTHY' });
                return { healthy: true, status: 'HEALTHY', blockReason: 'NONE' };
            }
            if (blockReason === 'ACCOUNT_SUSPENDED') {
                const msg = `Tài khoản Muse ${profile.email} đã bị khóa. Vui lòng đổi tài khoản khác.`;
                this.vault.updateHealthStatus(profileId, 'SUSPENDED', msg);
                this.emit('healthChanged', { profileId, status: 'SUSPENDED', messageVi: msg });
                return { healthy: false, status: 'SUSPENDED', blockReason };
            }
            this.vault.updateHealthStatus(profileId, 'REAUTH_NEEDED', 'Phiên Muse cần xác thực lại');
            return { healthy: false, status: 'REAUTH_NEEDED', blockReason };
        }
        catch {
            this.vault.rotateProxy(profileId);
            this.vault.updateHealthStatus(profileId, 'REAUTH_NEEDED', 'Lỗi kết nối Proxy khi kiểm tra phiên');
            return { healthy: false, status: 'REAUTH_NEEDED', blockReason: 'HTTP_401_403' };
        }
    }
    /**
     * Tự động đăng nhập lại tối đa 2 lần; chống gọi trùng lặp (Single-Flight) trên cùng 1 profileId
     */
    async ensureAuthenticated(profileId, detectedProbe) {
        const existingTask = this.inFlightRelogins.get(profileId);
        if (existingTask) {
            return existingTask;
        }
        const task = this.runReloginSequence(profileId, detectedProbe).finally(() => {
            this.inFlightRelogins.delete(profileId);
        });
        this.inFlightRelogins.set(profileId, task);
        return task;
    }
    async runReloginSequence(profileId, detectedProbe) {
        const profile = this.vault.getProfile(profileId);
        if (!profile) {
            return {
                success: false,
                attemptsUsed: 0,
                status: 'REAUTH_NEEDED',
                blockReason: 'LOGIN_REDIRECT',
                messageVi: 'Không tìm thấy hồ sơ tài khoản Muse trong kho lưu trữ.',
            };
        }
        if (profile.status === 'SUSPENDED') {
            return {
                success: false,
                attemptsUsed: 0,
                status: 'SUSPENDED',
                blockReason: 'ACCOUNT_SUSPENDED',
                messageVi: `Tài khoản Muse ${profile.email} đã bị khóa, đã ngừng tự động đăng nhập.`,
            };
        }
        if (detectedProbe) {
            const initialReason = detectMuseAuthBlock(detectedProbe);
            if (initialReason === 'ACCOUNT_SUSPENDED') {
                const msg = `Tài khoản Muse ${profile.email} đã bị đình chỉ.`;
                this.vault.updateHealthStatus(profileId, 'SUSPENDED', msg);
                return {
                    success: false,
                    attemptsUsed: 0,
                    status: 'SUSPENDED',
                    blockReason: initialReason,
                    messageVi: msg,
                };
            }
            if (initialReason === 'CAPTCHA_REQUIRED') {
                const msg = 'Muse yêu cầu xác minh Captcha → [Bấm xác nhận Captcha & Chạy tiếp]';
                this.vault.updateHealthStatus(profileId, 'REAUTH_NEEDED', msg);
                return {
                    success: false,
                    attemptsUsed: 0,
                    status: 'REAUTH_NEEDED',
                    blockReason: initialReason,
                    messageVi: msg,
                };
            }
        }
        // Nếu hồ sơ chỉ nạp cookie từ Extension mà không lưu mật khẩu -> yêu cầu sync lại Extension
        if (!profile.password) {
            const msg = 'Phiên cookie Muse đã hết hạn (tài khoản không lưu mật khẩu) → [Đồng bộ lại từ Extension]';
            this.vault.updateHealthStatus(profileId, 'REAUTH_NEEDED', msg);
            return {
                success: false,
                attemptsUsed: 0,
                status: 'REAUTH_NEEDED',
                blockReason: 'LOGIN_REDIRECT',
                messageVi: msg,
            };
        }
        const partition = museSessionVault_1.MuseSessionVault.getPartitionName(profileId);
        this.vault.updateHealthStatus(profileId, 'REAUTH_NEEDED', 'Đang tự động đăng nhập lại Muse...');
        this.emit('reloginStarted', { profileId });
        let lastBlockReason = 'LOGIN_REDIRECT';
        for (let attempt = 1; attempt <= exports.MUSE_AUTH_RULES.MAX_RELOGIN_ATTEMPTS; attempt++) {
            const proxyToUse = attempt === 1 ? this.vault.getActiveProxy(profileId) : this.vault.rotateProxy(profileId);
            if (proxyToUse) {
                await this.driver.applyProxy(partition, proxyToUse);
            }
            const totpCode = profile.totpSecret ? museSessionVault_1.VaultCrypto.generateTotp(profile.totpSecret) : undefined;
            try {
                const res = await this.driver.performInteractiveLogin({
                    partition,
                    loginUrl: exports.MUSE_AUTH_RULES.MUSE_LOGIN_URL,
                    email: profile.email,
                    password: profile.password,
                    totpCode,
                    timeoutMs: exports.MUSE_AUTH_RULES.STEP_TIMEOUT_MS,
                });
                if (res.success && res.blockReason === 'NONE') {
                    this.vault.updateHealthStatus(profileId, 'HEALTHY');
                    const okMsg = `Đăng nhập lại Muse thành công (lần thử ${attempt}/${exports.MUSE_AUTH_RULES.MAX_RELOGIN_ATTEMPTS}).`;
                    this.emit('reloginSucceeded', { profileId, attemptsUsed: attempt });
                    return {
                        success: true,
                        attemptsUsed: attempt,
                        status: 'HEALTHY',
                        blockReason: 'NONE',
                        messageVi: okMsg,
                    };
                }
                lastBlockReason = res.blockReason;
                if (res.blockReason === 'CAPTCHA_REQUIRED') {
                    const capMsg = 'Muse yêu cầu xác minh Captcha → [Bấm xác nhận Captcha & Chạy tiếp]';
                    this.vault.updateHealthStatus(profileId, 'REAUTH_NEEDED', capMsg);
                    return {
                        success: false,
                        attemptsUsed: attempt,
                        status: 'REAUTH_NEEDED',
                        blockReason: 'CAPTCHA_REQUIRED',
                        messageVi: capMsg,
                    };
                }
                if (res.blockReason === 'ACCOUNT_SUSPENDED') {
                    const susMsg = `Tài khoản Muse ${profile.email} đã bị khóa.`;
                    this.vault.updateHealthStatus(profileId, 'SUSPENDED', susMsg);
                    return {
                        success: false,
                        attemptsUsed: attempt,
                        status: 'SUSPENDED',
                        blockReason: 'ACCOUNT_SUSPENDED',
                        messageVi: susMsg,
                    };
                }
            }
            catch {
                lastBlockReason = 'HTTP_401_403';
            }
        }
        const failMsg = 'Không thể tự đăng nhập Muse sau 2 lần thử → [Kiểm tra mật khẩu / Đồng bộ lại Extension]';
        this.vault.updateHealthStatus(profileId, 'REAUTH_NEEDED', failMsg);
        this.emit('reloginFailed', { profileId, attemptsUsed: exports.MUSE_AUTH_RULES.MAX_RELOGIN_ATTEMPTS });
        return {
            success: false,
            attemptsUsed: exports.MUSE_AUTH_RULES.MAX_RELOGIN_ATTEMPTS,
            status: 'REAUTH_NEEDED',
            blockReason: lastBlockReason,
            messageVi: failMsg,
        };
    }
    /**
     * Heartbeat kiểm tra sức khỏe phiên định kỳ mỗi 15 phút
     */
    startHeartbeat(intervalMs = exports.MUSE_AUTH_RULES.HEARTBEAT_INTERVAL_MS) {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(async () => {
            const profiles = this.vault.listAllSummaries();
            for (const p of profiles) {
                if (p.status === 'SUSPENDED')
                    continue;
                const health = await this.checkSessionHealth(p.profileId);
                if (!health.healthy &&
                    health.blockReason !== 'CAPTCHA_REQUIRED' &&
                    health.blockReason !== 'ACCOUNT_SUSPENDED') {
                    await this.ensureAuthenticated(p.profileId);
                }
            }
        }, intervalMs);
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
}
exports.AutoReloginEngine = AutoReloginEngine;
