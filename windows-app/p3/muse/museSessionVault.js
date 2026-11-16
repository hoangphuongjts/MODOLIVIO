// @ts-nocheck - File bien dich tu TypeScript cua Gemini (tsc, CommonJS); da typecheck strict o dang .ts goc, khong typecheck lai bang --checkJs.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MuseSessionVault = exports.VaultCrypto = void 0;
const crypto_1 = __importDefault(require("crypto"));
// ==========================================
// 2. BỘ MÃ HÓA AES-256-GCM, HMAC & TOTP 6 SỐ (RFC 6238)
// ==========================================
class VaultCrypto {
    static ALGO = 'aes-256-gcm';
    static deriveKey(masterSecret) {
        return crypto_1.default.createHash('sha256').update(masterSecret, 'utf8').digest();
    }
    static encryptJson(data, masterSecret) {
        const key = this.deriveKey(masterSecret);
        const iv = crypto_1.default.randomBytes(12);
        const cipher = crypto_1.default.createCipheriv(this.ALGO, key, iv);
        const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
        const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
    }
    static decryptJson(cipherPayload, masterSecret) {
        const parts = cipherPayload.split(':');
        if (parts.length !== 3) {
            throw new Error('Dữ liệu mã hóa Vault sai định dạng');
        }
        const [ivHex, tagHex, dataHex] = parts;
        const key = this.deriveKey(masterSecret);
        const decipher = crypto_1.default.createDecipheriv(this.ALGO, key, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(dataHex, 'hex')),
            decipher.final(),
        ]);
        return JSON.parse(decrypted.toString('utf8'));
    }
    static verifyHmacSha256(payloadStr, pairingSecret, signatureHex) {
        const expected = crypto_1.default.createHmac('sha256', pairingSecret).update(payloadStr, 'utf8').digest('hex');
        const a = Buffer.from(expected, 'hex');
        const b = Buffer.from(signatureHex, 'hex');
        if (a.length !== b.length)
            return false;
        return crypto_1.default.timingSafeEqual(a, b);
    }
    static generateTotp(base32Secret, timestampMs = Date.now()) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const cleaned = base32Secret.replace(/[\s=-]/g, '').toUpperCase();
        let bits = '';
        for (const char of cleaned) {
            const val = alphabet.indexOf(char);
            if (val >= 0)
                bits += val.toString(2).padStart(5, '0');
        }
        const keyBytes = [];
        for (let i = 0; i + 8 <= bits.length; i += 8) {
            keyBytes.push(parseInt(bits.slice(i, i + 8), 2));
        }
        const counter = Math.floor(timestampMs / 1000 / 30);
        const counterBuf = Buffer.alloc(8);
        counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
        counterBuf.writeUInt32BE(counter >>> 0, 4);
        const hmac = crypto_1.default.createHmac('sha1', Buffer.from(keyBytes)).update(counterBuf).digest();
        const offset = hmac[hmac.length - 1] & 0x0f;
        const code = (((hmac[offset] & 0x7f) << 24) |
            ((hmac[offset + 1] & 0xff) << 16) |
            ((hmac[offset + 2] & 0xff) << 8) |
            (hmac[offset + 3] & 0xff)) %
            1_000_000;
        return String(code).padStart(6, '0');
    }
}
exports.VaultCrypto = VaultCrypto;
// ==========================================
// 3. KHO LƯU TRỮ HỒ SƠ & NẠP COOKIE HTTPONLY VÀO PARTITION
// ==========================================
class MuseSessionVault {
    masterSecret;
    pairingSecret;
    rows = new Map();
    constructor(masterSecret, pairingSecret) {
        this.masterSecret = masterSecret;
        this.pairingSecret = pairingSecret;
        if (!masterSecret || masterSecret.length < 16) {
            throw new Error('Master secret của MuseSessionVault phải có tối thiểu 16 ký tự');
        }
        if (!pairingSecret || pairingSecret.length < 16) {
            throw new Error('Pairing secret của Companion Extension phải có tối thiểu 16 ký tự');
        }
    }
    static getPartitionName(profileId) {
        return `persist:mo-muse-${profileId}`;
    }
    upsertProfile(input) {
        const existing = this.getProfile(input.profileId);
        const secretBlob = {
            password: input.password ?? existing?.password,
            totpSecret: input.totpSecret ?? existing?.totpSecret,
            primaryProxy: input.primaryProxy,
            fallbackProxies: input.fallbackProxies ?? existing?.fallbackProxies ?? [],
            importedCookies: existing?.importedCookies ?? [],
        };
        const row = {
            profileId: input.profileId,
            email: input.email.trim().toLowerCase(),
            cipherPayload: VaultCrypto.encryptJson(secretBlob, this.masterSecret),
            activeProxyIndex: existing?.activeProxyIndex ?? 0,
            cookieSyncedAt: existing?.cookieSyncedAt ?? null,
            status: existing?.status ?? 'REAUTH_NEEDED',
            lastHealthyAt: existing?.lastHealthyAt ?? null,
            updatedAt: Date.now(),
        };
        this.rows.set(input.profileId, row);
        return this.getProfile(input.profileId);
    }
    /**
     * Nhận gói cookie HttpOnly từ Companion Extension, kiểm tra chữ ký HMAC + chống replay > 5 phút,
     * sau đó mã hóa AES-256-GCM lưu vào Vault.
     */
    importCookiesFromExtension(envelope) {
        const MAX_AGE_MS = 5 * 60_000;
        if (Math.abs(Date.now() - envelope.capturedAt) > MAX_AGE_MS) {
            throw new Error('Gói đồng bộ cookie từ Extension đã quá hạn (> 5 phút)');
        }
        const canonicalBody = JSON.stringify({
            profileId: envelope.profileId,
            capturedAt: envelope.capturedAt,
            cookies: envelope.cookies,
        });
        if (!VaultCrypto.verifyHmacSha256(canonicalBody, this.pairingSecret, envelope.signatureHex)) {
            throw new Error('Chữ ký HMAC từ Companion Extension không hợp lệ');
        }
        // Lọc chỉ nhận cookie thuộc domain muse.ai
        // [SỬA KHI TÍCH HỢP — Annie] đồng thời loại cookie đã hết hạn ngay lúc nạp,
        // để số cookie lưu trong Vault khớp số cookie nạp được vào partition
        // (trước đây cookie hết hạn vẫn bị đếm trong listAllSummaries).
        const nowSec = Math.floor(Date.now() / 1000);
        const validMuseCookies = envelope.cookies.filter((c) => {
            const d = (c.domain || '').toLowerCase();
            const domainOk = d === 'muse.ai' || d.endsWith('.muse.ai');
            const notExpired = !c.expirationDate || c.expirationDate > nowSec;
            return domainOk && notExpired;
        });
        if (validMuseCookies.length === 0) {
            throw new Error('Không có cookie hợp lệ nào thuộc domain muse.ai');
        }
        let profile = this.getProfile(envelope.profileId);
        if (!profile) {
            // Tự tạo hồ sơ nếu người dùng đồng bộ trực tiếp từ Extension lần đầu
            profile = this.upsertProfile({
                profileId: envelope.profileId,
                email: envelope.emailHint || `${envelope.profileId}@muse.local`,
                primaryProxy: { protocol: 'http', host: 'direct', port: 0 },
            });
        }
        const updatedBlob = {
            password: profile.password,
            totpSecret: profile.totpSecret,
            primaryProxy: profile.primaryProxy,
            fallbackProxies: profile.fallbackProxies,
            importedCookies: validMuseCookies,
        };
        const row = this.rows.get(envelope.profileId);
        row.cipherPayload = VaultCrypto.encryptJson(updatedBlob, this.masterSecret);
        row.cookieSyncedAt = Date.now();
        row.updatedAt = Date.now();
        return {
            importedCount: validMuseCookies.length,
            httpOnlyCount: validMuseCookies.filter((c) => c.httpOnly).length,
        };
    }
    /**
     * Nạp toàn bộ cookie (bao gồm HttpOnly) vào phân vùng Electron persist:mo-muse-<profileId>
     */
    async injectCookiesIntoPartition(profileId, cookieStore) {
        const profile = this.getProfile(profileId);
        if (!profile || profile.importedCookies.length === 0) {
            return 0;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        let injected = 0;
        for (const c of profile.importedCookies) {
            // Bỏ qua cookie đã hết hạn
            if (c.expirationDate && c.expirationDate < nowSec)
                continue;
            const cleanDomain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
            const targetUrl = `${c.secure ? 'https' : 'http'}://${cleanDomain}${c.path || '/'}`;
            await cookieStore.set({
                url: targetUrl,
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path || '/',
                secure: c.secure,
                httpOnly: c.httpOnly,
                sameSite: c.sameSite || 'lax',
                expirationDate: c.expirationDate,
            });
            injected++;
        }
        await cookieStore.flushStore();
        return injected;
    }
    getProfile(profileId) {
        const row = this.rows.get(profileId);
        if (!row)
            return null;
        const decrypted = VaultCrypto.decryptJson(row.cipherPayload, this.masterSecret);
        return {
            profileId: row.profileId,
            email: row.email,
            password: decrypted.password,
            totpSecret: decrypted.totpSecret,
            primaryProxy: decrypted.primaryProxy,
            fallbackProxies: decrypted.fallbackProxies,
            activeProxyIndex: row.activeProxyIndex,
            importedCookies: decrypted.importedCookies || [],
            cookieSyncedAt: row.cookieSyncedAt,
            status: row.status,
            lastHealthyAt: row.lastHealthyAt,
            lastErrorVi: row.lastErrorVi,
            updatedAt: row.updatedAt,
        };
    }
    getActiveProxy(profileId) {
        const profile = this.getProfile(profileId);
        if (!profile)
            return null;
        if (profile.primaryProxy.host === 'direct')
            return null;
        const allProxies = [profile.primaryProxy, ...profile.fallbackProxies];
        return allProxies[profile.activeProxyIndex % allProxies.length] || profile.primaryProxy;
    }
    rotateProxy(profileId) {
        const row = this.rows.get(profileId);
        const profile = this.getProfile(profileId);
        if (!row || !profile || profile.primaryProxy.host === 'direct')
            return null;
        const totalProxies = 1 + profile.fallbackProxies.length;
        row.activeProxyIndex = (row.activeProxyIndex + 1) % totalProxies;
        row.updatedAt = Date.now();
        return this.getActiveProxy(profileId);
    }
    updateHealthStatus(profileId, status, errorMessageVi) {
        const row = this.rows.get(profileId);
        if (!row)
            return;
        row.status = status;
        row.lastErrorVi = errorMessageVi;
        if (status === 'HEALTHY') {
            row.lastHealthyAt = Date.now();
            row.lastErrorVi = undefined;
        }
        row.updatedAt = Date.now();
    }
    // [BỔ SUNG KHI TÍCH HỢP — Annie] Xuất/nhập các hàng vault đã mã hoá để lưu bền
    // xuống đĩa (file JSON trong thư mục dữ liệu app, xem museVaultStore.js).
    // Các hàng đã là ciphertext AES-256-GCM nên file đĩa không lộ mật khẩu hay
    // cookie; master secret vẫn phải được bảo vệ riêng (museSecrets.js —
    // Electron safeStorage/DPAPI trên Windows, fallback file khóa 0600).
    exportEncryptedRows() {
        return Array.from(this.rows.values()).map((row) => ({ ...row }));
    }
    importEncryptedRows(rows) {
        let imported = 0;
        for (const row of rows || []) {
            if (!row || typeof row.profileId !== 'string' || typeof row.cipherPayload !== 'string')
                continue;
            this.rows.set(row.profileId, { ...row });
            imported++;
        }
        return imported;
    }
    listAllSummaries() {
        return Array.from(this.rows.keys()).map((id) => {
            const full = this.getProfile(id);
            const { password: _p, totpSecret: _t, importedCookies, ...safeSummary } = full;
            return {
                ...safeSummary,
                cookieCount: importedCookies.length,
            };
        });
    }
}
exports.MuseSessionVault = MuseSessionVault;
