// @ts-nocheck - File bien dich tu TypeScript cua Gemini (tsc, CommonJS); da typecheck strict o dang .ts goc, khong typecheck lai bang --checkJs.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElectronMuseBrowserDriver = void 0;
const electron_1 = require("electron");
const autoReloginEngine_1 = require("./autoReloginEngine");
class ElectronMuseBrowserDriver {
    /**
     * Trả về kho cookie chuẩn của Electron partition persist:mo-muse-<profileId>
     * (Hỗ trợ ghi đầy đủ cờ httpOnly, secure, sameSite, expirationDate)
     */
    getCookieStore(partition) {
        const ses = electron_1.session.fromPartition(partition);
        return {
            set: async (details) => {
                await ses.cookies.set(details);
            },
            flushStore: async () => {
                await ses.cookies.flushStore();
            },
        };
    }
    /**
     * Áp cấu hình Proxy riêng biệt cho từng partition Muse
     */
    async applyProxy(partition, proxy) {
        const ses = electron_1.session.fromPartition(partition);
        if (!proxy || proxy.host === 'direct' || !proxy.port) {
            await ses.setProxy({ mode: 'direct' });
            return;
        }
        const proxyRules = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
        await ses.setProxy({
            proxyRules,
            proxyBypassRules: '127.0.0.1,localhost',
        });
    }
    /**
     * Thăm dò nhanh sức khỏe phiên qua net.fetch gắn đúng partition (không cần mở UI)
     */
    async probeSession(partition, endpointUrl) {
        const ses = electron_1.session.fromPartition(partition);
        const res = await ses.fetch(endpointUrl, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                Accept: 'application/json, text/html;q=0.9',
            },
        });
        const bodySnippet = (await res.text()).slice(0, 5000);
        return {
            statusCode: res.status,
            finalUrl: res.url || endpointUrl,
            bodySnippet,
        };
    }
    /**
     * Mở BrowserWindow cô lập với partition persist:mo-muse-<profileId>,
     * tự động điền Email/Password/2FA, bắt sớm 401/403/Captcha và giải phóng RAM khi xong.
     */
    async performInteractiveLogin(params) {
        return await new Promise((resolve) => {
            let settled = false;
            let win = new electron_1.BrowserWindow({
                show: false, // Ẩn mặc định; chỉ gọi win.show() nếu dính Captcha cần người dùng xác nhận
                width: 1180,
                height: 780,
                webPreferences: {
                    partition: params.partition,
                    nodeIntegration: false,
                    contextIsolation: true,
                },
            });
            const timer = setTimeout(() => {
                finish({
                    success: false,
                    blockReason: 'HTTP_401_403',
                    message: 'Quá thời gian đăng nhập Muse (45 giây)',
                });
            }, params.timeoutMs);
            const finish = (outcome) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                if (win && !win.isDestroyed()) {
                    win.destroy();
                }
                win = null;
                resolve(outcome);
            };
            win.webContents.on('did-finish-load', async () => {
                if (!win || win.isDestroyed() || settled)
                    return;
                try {
                    const currentUrl = win.webContents.getURL();
                    const htmlSnippet = (await win.webContents.executeJavaScript(`document.body ? document.body.innerHTML.slice(0, 5000) : ''`)); // [SỬA KHI TÍCH HỢP — Annie] ép kiểu string cho strict mode
                    // 1. Nếu URL đã rời khỏi /login và không dính Captcha/Suspended -> Đăng nhập thành công
                    const blockCheck = (0, autoReloginEngine_1.detectMuseAuthBlock)({
                        statusCode: 200,
                        finalUrl: currentUrl,
                        bodySnippet: htmlSnippet,
                    });
                    if (blockCheck === 'ACCOUNT_SUSPENDED') {
                        finish({ success: false, blockReason: 'ACCOUNT_SUSPENDED' });
                        return;
                    }
                    if (blockCheck === 'CAPTCHA_REQUIRED') {
                        // Hiển thị cửa sổ để người bán giải Captcha 1 lần nếu cần
                        win.show();
                        finish({
                            success: false,
                            blockReason: 'CAPTCHA_REQUIRED',
                            message: 'Phát hiện Captcha trên trang đăng nhập Muse',
                        });
                        return;
                    }
                    if (!currentUrl.toLowerCase().includes('/login') && blockCheck === 'NONE') {
                        const ses = electron_1.session.fromPartition(params.partition);
                        await ses.cookies.flushStore();
                        finish({ success: true, blockReason: 'NONE' });
                        return;
                    }
                    // 2. Đang ở trang /login -> Tiêm script điền Email + Password + OTP (nếu có)
                    const safeEmail = JSON.stringify(params.email);
                    const safePass = JSON.stringify(params.password);
                    const safeOtp = JSON.stringify(params.totpCode || '');
                    await win.webContents.executeJavaScript(`
            (() => {
              const setNativeValue = (el, val) => {
                if (!el) return;
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (setter) setter.call(el, val);
                else el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              };

              const emailInput = document.querySelector('input[type="email"], input[name="email"]');
              const passInput = document.querySelector('input[type="password"], input[name="password"]');
              const otpInput = document.querySelector('input[name="otp"], input[name="code"], input[autocomplete="one-time-code"]');

              if (emailInput && !emailInput.value) setNativeValue(emailInput, ${safeEmail});
              if (passInput && !passInput.value) setNativeValue(passInput, ${safePass});
              if (otpInput && ${safeOtp}) setNativeValue(otpInput, ${safeOtp});

              const submitBtn = document.querySelector('button[type="submit"]');
              if (submitBtn) submitBtn.click();
            })()
          `);
                }
                catch (err) {
                    finish({
                        success: false,
                        blockReason: 'LOGIN_REDIRECT',
                        message: err?.message || 'Lỗi thao tác DOM đăng nhập Muse',
                    });
                }
            });
            win.webContents.on('did-fail-load', (_e, code, desc) => {
                if (code === -3)
                    return;
                finish({
                    success: false,
                    blockReason: 'HTTP_401_403',
                    message: `Lỗi tải trang Muse (${code}): ${desc}`,
                });
            });
            win.loadURL(params.loginUrl);
        });
    }
    /**
     * Điểm nối cho động cơ Muse của t3:
     * Mở phiên Managed Chrome CDP đã nạp sẵn cookie HttpOnly từ persist:mo-muse-<profileId>
     */
    async openManagedCdpSession(params) {
        if (params.proxy) {
            await this.applyProxy(params.partition, params.proxy);
        }
        const win = new electron_1.BrowserWindow({
            show: false,
            width: 1280,
            height: 800,
            webPreferences: {
                partition: params.partition,
                nodeIntegration: false,
                contextIsolation: true,
            },
        });
        // Gắn Electron CDP Debugger Protocol chuẩn (1.3) để t3 điều khiển trang Muse đã đăng nhập
        if (!win.webContents.debugger.isAttached()) {
            win.webContents.debugger.attach('1.3');
        }
        await win.loadURL(params.targetUrl);
        return {
            window: win,
            sendCdpCommand: (method, commandParams) => {
                return win.webContents.debugger.sendCommand(method, commandParams);
            },
            dispose: () => {
                if (!win.isDestroyed()) {
                    if (win.webContents.debugger.isAttached()) {
                        win.webContents.debugger.detach();
                    }
                    win.destroy();
                }
            },
        };
    }
}
exports.ElectronMuseBrowserDriver = ElectronMuseBrowserDriver;
