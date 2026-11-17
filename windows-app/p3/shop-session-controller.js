"use strict";

// One visible WebContentsView per authenticated shop, owned by Electron main.
// Only platform content is read; cookie/session/token APIs are intentionally absent.
const { readProductFromWebContents, shopPlatformForUrl } = require("./product-dom-reader.js");

const SHOP_CONFIG = Object.freeze({
  shopee: Object.freeze({ partition: "persist:shopee", home: "https://shopee.vn/", name: "Shopee" }),
  tiktok: Object.freeze({ partition: "persist:tiktok", home: "https://www.tiktok.com/", name: "TikTok Shop" }),
});

function isShopNavigation(platform, href) {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (platform === "shopee") return host === "shopee.vn" || host.endsWith(".shopee.vn");
    if (platform === "tiktok") return host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch { /* bad url */ }
  return false;
}

class ShopSessionController {
  constructor({ BrowserWindow, WebContentsView, session, readProduct = readProductFromWebContents } = {}) {
    if (!BrowserWindow || !WebContentsView || !session?.fromPartition) throw new Error("SHOP_ELECTRON_UNAVAILABLE");
    this.BrowserWindow = BrowserWindow;
    this.WebContentsView = WebContentsView;
    this.session = session;
    this.readProduct = readProduct;
    this.entries = new Map();
  }

  open(platform) {
    const conf = SHOP_CONFIG[platform];
    if (!conf) throw new Error("UNSUPPORTED_DOMAIN: sàn chưa hỗ trợ");
    const previous = this.entries.get(platform);
    if (previous && !previous.window.isDestroyed?.()) {
      previous.window.show(); previous.window.focus();
      return { platform, partition: conf.partition, opened: true, confirmed: previous.confirmed };
    }
    const isolatedSession = this.session.fromPartition(conf.partition);
    const window = new this.BrowserWindow({
      title: `MODOLIVIO · Phiên ${conf.name}`, width: 1120, height: 790, minWidth: 640, minHeight: 480,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const view = new this.WebContentsView({ webPreferences: {
      partition: conf.partition, session: isolatedSession, sandbox: true,
      contextIsolation: true, nodeIntegration: false,
    } });
    window.contentView.addChildView(view);
    const resize = () => {
      const { width, height } = window.getContentBounds();
      view.setBounds({ x: 0, y: 0, width, height });
    };
    resize(); window.on("resize", resize);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event, target) => {
      if (!isShopNavigation(platform, target)) event.preventDefault();
    });
    const record = { window, view, confirmed: false, partition: conf.partition, reading: false };
    this.entries.set(platform, record);
    window.on("closed", () => {
      if (this.entries.get(platform) === record) this.entries.delete(platform);
      try { view.webContents.close(); } catch { /* already disposed */ }
    });
    Promise.resolve(view.webContents.loadURL(conf.home)).catch(() => { /* visible view displays navigation state */ });
    return { platform, partition: conf.partition, opened: true, confirmed: false };
  }

  confirm(platform) {
    const record = this.entries.get(platform);
    if (!record || record.window.isDestroyed?.()) throw new Error("LOGIN_REQUIRED: mở phiên sàn trong MODOLIVIO trước");
    if (!isShopNavigation(platform, record.view.webContents.getURL())) throw new Error("LOGIN_REQUIRED: trang sàn chưa mở");
    if (/\/login|\/sign[-_]?in/i.test(new URL(record.view.webContents.getURL()).pathname))
      throw new Error("LOGIN_REQUIRED: vẫn đang ở trang đăng nhập");
    // Confirmation is user attestation only; DOM checks revalidate at every read.
    record.confirmed = true;
    return { platform, confirmed: true, partition: record.partition };
  }

  status(platform) {
    if (platform) {
      const item = this.entries.get(platform);
      return { platform, opened: Boolean(item), confirmed: Boolean(item?.confirmed), partition: SHOP_CONFIG[platform]?.partition || null };
    }
    return Object.keys(SHOP_CONFIG).map(name => this.status(name));
  }

  async read(url, options = {}) {
    const platform = shopPlatformForUrl(url);
    if (!platform) throw new Error("UNSUPPORTED_DOMAIN: link sàn không được hỗ trợ");
    const record = this.entries.get(platform);
    if (!record || !record.confirmed || record.window.isDestroyed?.())
      throw new Error("LOGIN_REQUIRED: mở và xác nhận phiên đăng nhập sàn trong MODOLIVIO trước");
    if (record.reading) throw new Error("SHOP_BUSY: đang đọc một link khác trong cùng phiên");
    if (!isShopNavigation(platform, record.view.webContents.getURL()))
      throw new Error("LOGIN_REQUIRED: WebContentsView không còn ở đúng phiên sàn");
    record.reading = true;
    try {
      return await this.readProduct(record.view, url, { minImages: 4, timeoutMs: 45_000, sessionReady: true, ...options });
    } finally { record.reading = false; }
  }

  close() {
    for (const { window } of this.entries.values()) if (!window.isDestroyed?.()) window.close();
  }
}

module.exports = { SHOP_CONFIG, ShopSessionController, isShopNavigation };