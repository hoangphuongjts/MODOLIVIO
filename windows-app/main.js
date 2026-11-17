// main.js — Tiến trình chính của MODOLIVIO Windows (Electron).
"use strict";

const { app, BrowserWindow, Menu, shell, dialog, ipcMain, Tray, nativeImage, session, safeStorage, WebContentsView, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { createServer } = require("./server.js");
const { createBridgeAgent } = require("./p3/bridge-agent.js");
const { createRenderRouter } = require("./p3/provider-selector.js");
const { createFaceLockGate } = require("./p3/face-lock-gate.js");
const { MuseSessionVault } = require("./p3/session-vault.js");
const { SessionHealthMonitor, AutoReloginEngine } = require("./p3/session-health.js");
const { ShopSessionController } = require("./p3/shop-session-controller.js");
const { storeImportedShopProduct } = require("./p3/shop-import.js");
const { shopPlatformForUrl } = require("./p3/product-dom-reader.js");

const APP_VERSION = "1.3.0-win1";
const VIENEU_URL = process.env.MODOLIVIO_VIENEU_URL || "http://127.0.0.1:8123";
const SMOKE_TEST = process.argv.includes("--smoke-test");
if (SMOKE_TEST && process.env.SMOKE_USER_DATA_DIR) {
  fs.mkdirSync(process.env.SMOKE_USER_DATA_DIR, { recursive: true });
  app.setPath("userData", process.env.SMOKE_USER_DATA_DIR);
}

let mainWindow = null;
let localServer = null;
let localPort = 0;
let dataDir = "";
let localStore = null;
let bridgeAgent = null;
let tray = null;
let quitting = false;
let museVault = null;
let museCookieStore = null;
const museWindows = new Map();
const museHealth = new Map();
const museSessionListeners = new WeakSet();
let userAssistedRelogin = null;
let shopSessionController = null;

function dataDirFor() {
  return path.join(app.getPath("userData"), "MODOLIVIO");
}

async function startLocalServer() {
  dataDir = dataDirFor();
  const { server, store } = createServer({ dataDir, rendererDir: path.join(__dirname, "renderer"), shopImporter: readAndStoreShopProduct });
  localServer = server;
  localStore = store;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      localPort = server.address().port;
      resolve();
    });
  });
}

async function startBridgeAgent() {
  const bridgeDir = path.join(dataDir, "bridge");
  const museEnabled = process.env.MODOLIVIO_MUSE_ENGINE === "1";
  const provider = createRenderRouter({
    enableMuse: museEnabled,
    defaultProvider: process.env.MODOLIVIO_RENDER_PROVIDER || "seedance",
    dataDir: bridgeDir,
    cookieVault: museCookieStore?.vault || null,
    allowedProfileId: process.env.MODOLIVIO_MUSE_ALLOWED_PROFILE_ID || "",
  });
  bridgeAgent = await createBridgeAgent({
    dataDir: bridgeDir,
    provider,
    allowedOrigins: [`http://127.0.0.1:${localPort}`, `http://localhost:${localPort}`],
    faceLockGate: createFaceLockGate(),
    diskFreeBytes: async (dir) => {
      const { statfs } = require("fs/promises");
      const stat = await statfs(dir);
      return Number(stat.bavail) * Number(stat.bsize);
    },
    emit: (event) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("modolivio:bridge-event", event); },
  });
  if (typeof provider.setBridgePort === "function") provider.setBridgePort(bridgeAgent.port);
  const image = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pyoAAAAASUVORK5CYII=");
  tray = new Tray(image);
  tray.setToolTip(`MODOLIVIO Bridge Agent · 127.0.0.1:${bridgeAgent.port}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Bridge Agent hoạt động · cổng ${bridgeAgent.port}`, enabled: false },
    { label: "Xem mã ghép nối extension", click: () => dialog.showMessageBox({ type: "info", title: "Ghép nối MODOLIVIO Shop Grab", message: `Bridge: 127.0.0.1:${bridgeAgent.port}`, detail: `Mã ghép nối một lần: ${bridgeAgent.pairingCode}\n\nCấu hình MODOLIVIO_BRIDGE_ALLOWED_ORIGINS với đúng extension origin trước khi ghép nối.` }) },
    { label: "Mở MODOLIVIO", click: () => { if (!mainWindow) createWindow(); else mainWindow.show(); } },
    { label: "Thoát Bridge Agent", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", () => { if (!mainWindow) createWindow(); else mainWindow.show(); });
}

function configuredMuseUrl() {
  const raw = process.env.MODOLIVIO_MUSE_LOGIN_URL;
  if (!raw) throw new Error("Muse sign-in URL chưa được cấu hình; không tự đoán endpoint đăng nhập.");
  const url = new URL(raw);
  const allowed = new Set((process.env.MODOLIVIO_MUSE_ALLOWED_ORIGINS || "").split(",").map((part) => part.trim()).filter(Boolean));
  if (url.protocol !== "https:" || !allowed.has(url.origin)) throw new Error("Muse sign-in phải là HTTPS và khớp chính xác MODOLIVIO_MUSE_ALLOWED_ORIGINS.");
  return url;
}

async function openMuseSignIn(profileId) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profileId || "")) throw new Error("profileId không hợp lệ");
  if (!museVault) throw new Error("Muse session vault bị khóa: DPAPI/safeStorage không sẵn sàng.");
  const target = configuredMuseUrl();
  const existing = museWindows.get(profileId);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return true; }
  const partition = museVault.partition(profileId);
  const profileSession = session.fromPartition(partition);
  let health;
  health = new SessionHealthMonitor({ profileId, onHeartbeat: async () => {
    const activeWindow = museWindows.get(profileId);
    if (!activeWindow || activeWindow.isDestroyed()) return;
    try {
      const bodyText = await activeWindow.webContents.executeJavaScript("document.body?.innerText?.slice(0, 4096) || ''", true);
      health.observeResponse({ url: activeWindow.webContents.getURL(), bodyText });
    } catch { /* page transition; the next 15-minute check will retry */ }
  }, onInvalid: (signal) => {
    bridgeAgent?.safety.observe(profileId, signal.reason, { status: signal.status, url: signal.url });
    void userAssistedRelogin.sessionInvalid(profileId, signal.status || signal.url);
  } });
  if (!museSessionListeners.has(profileSession)) {
    const origins = (process.env.MODOLIVIO_MUSE_ALLOWED_ORIGINS || "").split(",").map((part) => part.trim()).filter(Boolean);
    profileSession.webRequest.onCompleted({ urls: origins.map((origin) => `${origin}/*`) }, (details) => {
      const monitor = museHealth.get(profileId);
      if (monitor && (details.statusCode === 401 || details.statusCode === 403)) monitor.observeResponse({ status: details.statusCode, url: details.url });
    });
    museSessionListeners.add(profileSession);
  }
  const window = new BrowserWindow({ width: 1180, height: 820, title: `Muse · ${profileId}`,
    webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  museWindows.set(profileId, window); museHealth.set(profileId, health); health.start();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, nextUrl) => {
    let nextOrigin = ""; try { nextOrigin = new URL(nextUrl).origin; } catch { /* reject malformed URL */ }
    if (!new Set((process.env.MODOLIVIO_MUSE_ALLOWED_ORIGINS || "").split(",").map((part) => part.trim()).filter(Boolean)).has(nextOrigin)) event.preventDefault();
  });
  window.webContents.on("did-navigate", (_event, url) => health.observeResponse({ url }));
  window.webContents.on("did-finish-load", async () => {
    try {
      const bodyText = await window.webContents.executeJavaScript("document.body?.innerText?.slice(0, 4096) || ''", true);
      health.observeResponse({ url: window.webContents.getURL(), bodyText });
    } catch { /* destroyed/navigating renderer; next navigation is monitored */ }
  });
  window.on("closed", () => { health.stop(); museWindows.delete(profileId); museHealth.delete(profileId); });
  await window.loadURL(target.href);
  return true;
}


function requireShopController() {
  if (!shopSessionController) throw new Error("LOGIN_REQUIRED: chưa khởi tạo phiên sàn trong MODOLIVIO");
  return shopSessionController;
}
async function readAndStoreShopProduct(url) {
  if (!localStore) throw new Error("SHOP_STORE_UNAVAILABLE");
  const snapshot = await requireShopController().read(url);
  return storeImportedShopProduct(localStore, snapshot);
}
async function readShopClipboard(platform) {
  const url = clipboard.readText().trim();
  if (!url || shopPlatformForUrl(url) !== platform) throw new Error("UNSUPPORTED_DOMAIN: clipboard phải chứa đúng một link sản phẩm HTTPS của sàn đã chọn");
  const product = await readAndStoreShopProduct(url);
  await dialog.showMessageBox(mainWindow || undefined, {
    type:"info", title:"Đã nhập sản phẩm",
    message:`Đã lưu “${product.title}” và ${product.imageCount} ảnh gốc`,
    detail:"Đọc qua cùng WebContentsView đã đăng nhập; không xuất cookie hoặc phiên.",
  });
  return product;
}
function shopAction(action) {
  return () => Promise.resolve().then(action).catch(error => dialog.showErrorBox("MODOLIVIO S4", String(error.message || error)));
}
function shopMenuEntries() {
  return [
    { label:"Mở phiên Shopee (đăng nhập thủ công)", click:shopAction(()=>requireShopController().open("shopee")) },
    { label:"Xác nhận đã đăng nhập Shopee", click:shopAction(()=>requireShopController().confirm("shopee")) },
    { label:"Đọc link Shopee từ clipboard → Kho sản phẩm", click:shopAction(()=>readShopClipboard("shopee")) },
    { type:"separator" },
    { label:"Mở phiên TikTok Shop (đăng nhập thủ công)", click:shopAction(()=>requireShopController().open("tiktok")) },
    { label:"Xác nhận đã đăng nhập TikTok Shop", click:shopAction(()=>requireShopController().confirm("tiktok")) },
    { label:"Đọc link TikTok Shop từ clipboard → Kho sản phẩm", click:shopAction(()=>readShopClipboard("tiktok")) },
  ];
}

function buildMenu() {
  const template = [
    {
      label: "Tệp",
      submenu: [
        { label: "Mở thư mục dữ liệu", click: () => shell.openPath(dataDir) },
        { label: "Mở thư mục tải lên", click: () => shell.openPath(path.join(dataDir, "uploads")) },
        { label: "Mở thư mục video đã xuất", click: () => shell.openPath(path.join(dataDir, "bridge", "exports")) },
        { label: "Mở Muse đăng nhập thủ công…", click: async () => {
          const answer = await dialog.showMessageBox(mainWindow, { type: "question", title: "Muse profile", message: "Mở phiên Muse trong profile tách biệt?", detail: "Chỉ mở trang đăng nhập hiển thị để bạn tự thao tác. MODOLIVIO không đọc cookie, tự điền mật khẩu hay giải CAPTCHA.", buttons: ["Mở", "Hủy"], defaultId: 0, cancelId: 1 });
          if (answer.response !== 0) return;
          try { await openMuseSignIn("default"); } catch (error) { dialog.showErrorBox("Không mở được Muse", error.message); }
        } },
        { type: "separator" },
        { label: "Phiên sàn Shopee / TikTok Shop", submenu: shopMenuEntries() },
        { type: "separator" },
        { label: "Thoát", role: "quit" },
      ],
    },
    {
      label: "Đồng bộ",
      submenu: [
        {
          label: "Xuất bản sao lưu đầy đủ (đồng bộ sang bản web)",
          click: async () => {
            const { exportBackup } = require("./bridge.js");
            const file = await dialog.showSaveDialog(mainWindow, {
              title: "Xuất bản sao lưu đầy đủ MODOLIVIO",
              defaultPath: `modolivio-backup-${new Date().toISOString().slice(0, 10)}.json`,
              filters: [{ name: "Bản sao lưu MODOLIVIO", extensions: ["json"] }],
            });
            if (file.canceled || !file.filePath) return;
            fs.writeFileSync(file.filePath, JSON.stringify(exportBackup(localStore), null, 2), "utf8");
            dialog.showMessageBox(mainWindow, {
              type: "info", title: "Đã xuất bản sao lưu",
              message: "Đã xuất toàn bộ dữ liệu ra file.",
              detail: "Mang file này sang bản còn lại và chọn Đồng bộ → Nhập bản sao lưu đầy đủ để gộp dữ liệu vào.\nLưu ý: file không mang theo ảnh/nhạc đã tải lên (nằm trong thư mục uploads của từng máy).",
            });
          },
        },
        {
          label: "Nhập bản sao lưu đầy đủ (gộp dữ liệu từ bản web)",
          click: async () => {
            const { importBackup } = require("./bridge.js");
            const picked = await dialog.showOpenDialog(mainWindow, {
              title: "Nhập bản sao lưu đầy đủ MODOLIVIO",
              filters: [{ name: "Bản sao lưu MODOLIVIO", extensions: ["json"] }],
              properties: ["openFile"],
            });
            if (picked.canceled || !picked.filePaths[0]) return;
            const answer = await dialog.showMessageBox(mainWindow, {
              type: "question", title: "Nhập bản sao lưu",
              message: "Gộp dữ liệu từ file sao lưu vào máy này?",
              detail: "Mục nào cùng mã sẽ ghi đè bằng bản mới hơn, mục mới sẽ được thêm vào. Dữ liệu hiện có trên máy không bị xóa.",
              buttons: ["Gộp dữ liệu", "Hủy"], defaultId: 0, cancelId: 1,
            });
            if (answer.response !== 0) return;
            try {
              const payload = JSON.parse(fs.readFileSync(picked.filePaths[0], "utf8"));
              const counts = importBackup(localStore, payload);
              dialog.showMessageBox(mainWindow, {
                type: "info", title: "Đã nhập xong",
                message: `Đã gộp dữ liệu: thêm mới ${counts.added} mục, cập nhật ${counts.updated} mục.`,
                detail: "Tải lại app (Xem → Tải lại) để thấy dữ liệu mới. Ảnh/nhạc tải lên không nằm trong file sao lưu nên cần chép tay thư mục uploads nếu cần.",
              });
            } catch (e) {
              dialog.showErrorBox("Không nhập được", e.message || String(e));
            }
          },
        },
        { type: "separator" },
        {
          label: "Đồng bộ hoạt động thế nào?",
          click: () => dialog.showMessageBox(mainWindow, {
            type: "info", title: "Đồng bộ web ↔ Windows",
            message: "Đồng bộ bằng file sao lưu đầy đủ (chưa có đồng bộ tự động qua mạng).",
            detail: "Bản web và bản Windows chưa có máy chủ đám mây chung để tự đồng bộ. Cách dùng: ở bản này chọn Đồng bộ → Xuất bản sao lưu đầy đủ, sang bản kia chọn Đồng bộ → Nhập bản sao lưu đầy đủ (trên bản web: dùng nút Xuất/Nhập file dự án cho từng dự án, hoặc nhập file sao lưu đầy đủ qua bản Windows).\n\nTài khoản MODOLIVIO: đăng ký cùng email + mật khẩu ở cả hai bản là đăng nhập được cả hai (cùng thuật toán băm mật khẩu).",
          }),
        },
      ],
    },
    {
      label: "Xem",
      submenu: [
        { label: "Tải lại", role: "reload" },
        { label: "Phóng to", role: "zoomIn" },
        { label: "Thu nhỏ", role: "zoomOut" },
        { label: "Cỡ chữ mặc định", role: "resetZoom" },
        { type: "separator" },
        { label: "Toàn màn hình", role: "togglefullscreen" },
        { label: "Công cụ nhà phát triển", role: "toggleDevTools" },
      ],
    },
    {
      label: "Trợ giúp",
      submenu: [
        {
          label: "Hướng dẫn sử dụng",
          click: () => shell.openExternal("https://muse.ai"),
        },
        {
          label: `Về MODOLIVIO ${APP_VERSION}`,
          click: () => dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Về MODOLIVIO",
            message: `MODOLIVIO ${APP_VERSION} — App Video Bán Hàng (bản Windows)`,
            detail: "Bản Windows chạy cục bộ trên máy của bạn: giao diện và quản lý dữ liệu dùng được ngoại tuyến.\n\nĐồng bộ với bản web: dùng menu Đồng bộ → Xuất/Nhập bản sao lưu đầy đủ (chưa có đồng bộ tự động qua mạng — xem HUONG-DAN.md).\n\nTính năng cần Muse AI (Làm nhanh, tạo ảnh/clip bằng AI) và đăng bài tự động cần bản web / tài khoản đã kết nối — xem file HUONG-DAN.md kèm theo.",
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const iconPng = path.join(__dirname, "assets", "icon.png");
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: "MODOLIVIO — App Video Bán Hàng",
    icon: fs.existsSync(iconPng) ? iconPng : undefined,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${localPort}/`);
  mainWindow.on("closed", () => { mainWindow = null; });

  // Mở link ngoài bằng trình duyệt mặc định, không mở trong app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith(`http://127.0.0.1:${localPort}`)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (SMOKE_TEST) {
    // Screenshots are from the *packaged Electron renderer*, never the Windows console.
    // Do not navigate to muse.ai, open a Muse profile, or reuse a user's Electron session.
    const errors = [];
    let started = false;
    const outputDir = process.env.SMOKE_OUT_DIR || path.join(app.getPath("temp"), "modolivio-ui-smoke");
    fs.mkdirSync(outputDir, { recursive: true });
    const reportFile = path.join(outputDir, "smoke-report.json");
    const frames = [];
    const actions = [];
    const watchdog = setTimeout(() => {
      errors.push("Timeout waiting for renderer UI smoke (60s)");
      fs.writeFileSync(reportFile, JSON.stringify({ status: "FAIL", errors, frames, actions }, null, 2));
      app.exit(2);
    }, 60000);
    watchdog.unref?.();
    const wc = mainWindow.webContents;
    wc.on("console-message", (_e, level, message, line, sourceId) => {
      if (level === "error") errors.push(`Console ${sourceId}:${line}: ${message}`);
    });
    wc.on("render-process-gone", (_e, details) => errors.push(`Renderer gone: ${JSON.stringify(details)}`));
    wc.on("did-fail-load", (_e, code, reason, url, isMainFrame) => {
      if (isMainFrame && code !== -3) errors.push(`Main-frame load failed ${code}: ${reason} ${url}`);
    });
    const evaluate = (expression) => wc.executeJavaScript(expression, true);
    const snapshotExpression = `(() => {
      const root = document.querySelector('[data-generated-space-root]');
      return {
        title: document.title,
        url: location.href,
        rootChildren: root ? root.children.length : 0,
        bodyText: (document.body?.innerText || '').slice(0, 1500),
        clicks: (window.__modolivioSmokeClicks || []).slice(),
        brandImages: Array.from(document.querySelectorAll('img[alt="Logo MODOLIVIO"]')).map(img => ({
          src: img.currentSrc || img.src, complete: img.complete, naturalWidth: img.naturalWidth,
        })),
      };
    })()`;
    const windowState = () => ({
      title: mainWindow.getTitle(),
      visible: mainWindow.isVisible(),
      nativeHandle: mainWindow.getNativeWindowHandle().toString("hex"),
      bounds: mainWindow.getBounds(),
      pid: process.pid,
    });
    async function captureFrame(stage, filename) {
      let state = await evaluate(snapshotExpression);
      // Do not allow CI to PASS when the official header logo has a broken image icon.
      for (let tries = 0; tries < 20; tries++) {
        if (state.brandImages?.length && state.brandImages.every(img => img.complete && img.naturalWidth > 0)) break;
        await new Promise(resolve => setTimeout(resolve, 250));
        state = await evaluate(snapshotExpression);
      }
      if (!state.brandImages?.length || state.brandImages.some(img => !img.complete || img.naturalWidth < 1)) {
        throw new Error(`OFFICIAL-LOGO-NOT-LOADED ${stage}: ${JSON.stringify(state.brandImages)}`);
      }
      if (!state.title.includes("MODOLIVIO") || state.rootChildren < 1 || state.bodyText.length < 100) {
        throw new Error(`Renderer DOM not ready for ${stage}: ${JSON.stringify(state)}`);
      }
      // DOM readiness and a successful capturePage() do NOT guarantee the first
      // Chromium compositor frame has actually painted on a Windows VM.
      // Retry only until REAL pixels contain enough app contrast and text strokes.
      let accepted = null;
      let metrics = null;
      for (let attempt = 1; attempt <= 24; attempt++) {
        const shot = await wc.capturePage();
        const bytes = shot.toPNG();
        const bitmap = shot.getBitmap();
        let samples = 0, total = 0, squared = 0, dark = 0;
        for (let i = 0; i + 3 < bitmap.length; i += 4 * 80) {
          const lum = (bitmap[i] + bitmap[i + 1] + bitmap[i + 2]) / 3;
          total += lum;
          squared += lum * lum;
          if (lum < 190) dark++;
          samples++;
        }
        const mean = samples ? total / samples : 0;
        const std = samples ? Math.sqrt(Math.max(0, squared / samples - mean * mean)) : 0;
        const darkRatio = samples ? dark / samples : 0;
        metrics = { attempt, bytes: bytes.length, samples, luminanceStd: Number(std.toFixed(2)),
          darkRatio: Number(darkRatio.toFixed(4)) };
        if (bytes.length >= 25000 && std >= 10 && darkRatio >= 0.015) {
          accepted = bytes;
          break;
        }
        console.warn("SMOKE-FRAME-NOT-PAINTED", JSON.stringify({ stage, ...metrics }));
        // A pointer move can stimulate a compositor frame on headless-ish VMs.
        mainWindow.show();
        mainWindow.focus();
        wc.focus();
        wc.sendInputEvent({ type: "mouseMove", x: 30 + attempt % 20, y: 30 });
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      if (!accepted) throw new Error(`No painted renderer screenshot for ${stage} after 24 attempts: ${JSON.stringify(metrics)}`);
      fs.writeFileSync(path.join(outputDir, filename), accepted);
      frames.push({ stage, filename, sizeBytes: accepted.length, quality: metrics, state, window: windowState() });
      console.log("SMOKE-RENDERER-FRAME", JSON.stringify({ stage, filename, sizeBytes: accepted.length,
        quality: metrics, title: state.title, bodyPreview: state.bodyText.slice(0, 140) }));
    }
    async function clickVisibleControl(label) {
      // Use native renderer mouse input: NOT DOM element.click() and NOT a desktop screenshot.
      const locator = `(() => {
        const label = ${JSON.stringify(label)};
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        const candidates = [...document.querySelectorAll('button, [role="button"], [role="tab"], a')];
        const el = candidates.find(n => normalize(n.innerText || n.textContent) === label) ||
          candidates.find(n => { const t = normalize(n.innerText || n.textContent); return t.endsWith(label) && t.length < label.length + 8; });
        if (!el) return { found: false, requested: label, nearby: candidates.map(n => normalize(n.innerText || n.textContent)).filter(Boolean).slice(0, 40) };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { found: true, requested: label, actualText: normalize(el.innerText || el.textContent),
          x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
          disabled: !!el.disabled, visible: r.width > 2 && r.height > 2 && style.visibility !== 'hidden' && style.display !== 'none',
          viewportWidth: innerWidth, viewportHeight: innerHeight };
      })()`;
      const target = await evaluate(locator);
      if (!target.found || !target.visible || target.disabled) throw new Error(`Control not interactable: ${JSON.stringify(target)}`);
      if (target.x < 0 || target.y < 0 || target.x >= target.viewportWidth || target.y >= target.viewportHeight) {
        throw new Error(`Control outside viewport: ${JSON.stringify(target)}`);
      }
      mainWindow.show();
      mainWindow.focus();
      wc.focus();
      wc.sendInputEvent({ type: "mouseMove", x: target.x, y: target.y });
      wc.sendInputEvent({ type: "mouseDown", x: target.x, y: target.y, button: "left", clickCount: 1 });
      wc.sendInputEvent({ type: "mouseUp", x: target.x, y: target.y, button: "left", clickCount: 1 });
      await new Promise(resolve => setTimeout(resolve, 1200));
      const state = await evaluate(snapshotExpression);
      const last = state.clicks[state.clicks.length - 1];
      if (!last || !(last.text || "").endsWith(label)) {
        throw new Error(`No renderer click event confirmed for ${label}: ${JSON.stringify(state.clicks)}`);
      }
      actions.push({ label, target, click: last, stateAfter: { title: state.title, bodyPreview: state.bodyText.slice(0, 180) } });
      console.log("SMOKE-RENDERER-CLICK", JSON.stringify({ label, target, click: last }));
    }
    wc.on("did-finish-load", () => {
      if (started) return;
      started = true;
      void (async () => {
        try {
          // React can mount later than did-finish-load; do not capture an empty view.
          let ready = false;
          for (let tries = 0; tries < 30; tries++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const state = await evaluate(snapshotExpression);
            if (state.rootChildren >= 1 && state.bodyText.includes("Làm nhanh") && state.bodyText.includes("Tổng quan")) {
              ready = true;
              break;
            }
          }
          if (!ready) throw new Error("Renderer UI did not become interactive after 15 seconds");
          mainWindow.show();
          mainWindow.focus();
          wc.focus();
          await evaluate(`(() => {
            window.__modolivioSmokeClicks = [];
            document.addEventListener('click', event => {
              const el = event.target.closest('button, [role="button"], [role="tab"], a');
              const text = ((el && (el.innerText || el.textContent)) || '').replace(/\\s+/g, ' ').trim();
              window.__modolivioSmokeClicks.push({ text, isTrusted: event.isTrusted, tag: el?.tagName || null });
            }, true);
            return true;
          })()`);
          await captureFrame("main", "01-main.png");
          await clickVisibleControl("Làm nhanh");
          await captureFrame("lam-nhanh", "02-lam-nhanh.png");
          await clickVisibleControl("Tổng quan");
          await captureFrame("tong-quan", "03-tong-quan.png");
          if (errors.length) throw new Error(`Renderer errors: ${errors.join(" | ")}`);
          fs.writeFileSync(reportFile, JSON.stringify({ status: "PASS", source: "packaged-electron-renderer",
            frames, actions, errors, window: windowState() }, null, 2));
          console.log("SMOKE-RENDERER-PASS", JSON.stringify({ files: frames.map(f => f.filename),
            clicks: actions.map(a => a.label), window: windowState() }));
          clearTimeout(watchdog);
          app.quit();
        } catch (error) {
          errors.push(String(error && error.stack || error));
          fs.writeFileSync(reportFile, JSON.stringify({ status: "FAIL", source: "packaged-electron-renderer",
            frames, actions, errors, window: windowState() }, null, 2));
          console.error("SMOKE-RENDERER-FAIL", error);
          clearTimeout(watchdog);
          app.exit(2);
        }
      })();
    });
  }
}



function assertMainShopCaller(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("SHOP_IPC_DENIED");
}
ipcMain.handle("modolivio:shop-open", (event, platform) => {
  assertMainShopCaller(event);
  return requireShopController().open(String(platform || ""));
});
ipcMain.handle("modolivio:shop-confirm", (event, platform) => {
  assertMainShopCaller(event);
  return requireShopController().confirm(String(platform || ""));
});
ipcMain.handle("modolivio:shop-status", event => {
  assertMainShopCaller(event);
  return requireShopController().status();
});
ipcMain.handle("modolivio:shop-read", async (event, url) => {
  assertMainShopCaller(event);
  const productUrl = String(url || "").trim();
  if (!shopPlatformForUrl(productUrl)) throw new Error("UNSUPPORTED_DOMAIN: chỉ chấp nhận link HTTPS Shopee/TikTok");
  return readAndStoreShopProduct(productUrl);
});

ipcMain.handle("modolivio:get-info", () => ({
  version: APP_VERSION,
  platform: process.platform,
  dataDir,
  localPort,
  vieneuUrl: VIENEU_URL,
  bridgePort: bridgeAgent?.port || null,
  bridgePairingCode: bridgeAgent?.pairingCode || null,
}));

ipcMain.handle("modolivio:bridge-status", () => ({
  port: bridgeAgent?.port || null,
  pairingCode: bridgeAgent?.pairingCode || null,
  state: bridgeAgent ? "running" : "stopped",
}));

ipcMain.handle("modolivio:muse-open-sign-in", async (_event, profileId) => openMuseSignIn(String(profileId || "")));
ipcMain.handle("modolivio:muse-confirm-sign-in", (_event, profileId) => { userAssistedRelogin?.markUserConfirmed(String(profileId || "")); return true; });
ipcMain.handle("modolivio:muse-session-vault-status", () => ({ ready: Boolean(museVault), backend: museVault ? safeStorage.getSelectedStorageBackend?.() || "unknown" : "unavailable" }));

ipcMain.handle("modolivio:open-data-folder", async () => {
  await shell.openPath(dataDir);
  return true;
});

ipcMain.handle("modolivio:check-tools", async () => {
  const out = { ffmpeg: false, ffmpegPath: "", vieneuRunning: false, vieneuError: "" };
  await new Promise((resolve) => {
    execFile("ffmpeg", ["-version"], { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout) { out.ffmpeg = true; out.ffmpegPath = "ffmpeg (trong PATH)"; }
      resolve();
    });
  });
  try {
    const res = await fetch(new URL("/v1/voices", VIENEU_URL), { signal: AbortSignal.timeout(5000) });
    out.vieneuRunning = res.ok;
    if (!res.ok) out.vieneuError = `Máy chủ VieNeu-TTS trả mã ${res.status}`;
  } catch {
    out.vieneuError = `Máy chủ VieNeu-TTS chưa chạy ở ${VIENEU_URL}`;
  }
  return out;
});

app.whenReady().then(async () => {
  try {
    museVault = new MuseSessionVault({ directory: path.join(app.getPath("userData"), "MODOLIVIO", "secure"), safeStorage });
    museVault.initialize();
    userAssistedRelogin = new AutoReloginEngine({ openUserSignIn: openMuseSignIn, maxAttempts: 2 });
  } catch (error) {
    museVault = null;
    console.warn("MuseSessionVault locked:", error.message);
  }
  if (process.env.MODOLIVIO_MUSE_ENGINE === "1" && !process.env.MODOLIVIO_MUSE_ALLOWED_PROFILE_ID) {
    console.warn("Muse engine blocked until MODOLIVIO_MUSE_ALLOWED_PROFILE_ID is configured for HY SINH");
    process.env.MODOLIVIO_MUSE_ENGINE = "0";
  }
  if (process.env.MODOLIVIO_MUSE_ENGINE === "1") {
    try {
      // The uploaded Gemini autoReloginEngine remains present but is NOT started:
      // only visible manual sign-in is permitted; never auto-fill credentials.
      const { createMuseCookieStore } = require("./p3/muse/museCookieStore.js");
      museCookieStore = createMuseCookieStore({ directory: path.join(dataDirFor(), "muse-secure"), safeStorage });
    } catch (error) {
      console.warn("Muse cookie vault blocked:", error.message);
      // Keep the UI available, but do not start Muse without a protected vault.
      process.env.MODOLIVIO_MUSE_ENGINE = "0";
    }
  }
  await startLocalServer();
  shopSessionController = new ShopSessionController({ BrowserWindow, WebContentsView, session });
  await startBridgeAgent();
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (quitting) return;
  // The Bridge Agent is designed to run in the tray after the window closes.
  if (process.platform === "darwin" && !tray) app.quit();
});

app.on("before-quit", async (event) => {
  try { shopSessionController?.close(); } catch { /* shutdown best effort */ }
  if (!bridgeAgent) { if (localServer) localServer.close(); return; }
  if (app.__p3Closing) return;
  event.preventDefault(); app.__p3Closing = true;
  try { await bridgeAgent.close(); } finally {
    bridgeAgent = null;
    if (localServer) await new Promise((resolve) => localServer.close(resolve));
    app.exit(0);
  }
});
