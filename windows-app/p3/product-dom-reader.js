"use strict";

// Run this in an existing authenticated WebContentsView, not a browser extension.
// Extracts only product content visible in that tab. Never reads cookies or auth tokens.
function extractProductSnapshot(doc = document, href = location.href) {
  const url = new URL(href);
  const h = url.hostname.toLowerCase();
  const allowed = h === "shopee.vn" || h === "www.shopee.vn" || h === "tiktok.com" || h === "www.tiktok.com" || h === "shop.tiktok.com";
  if (url.protocol !== "https:" || !allowed) return { ok: false, reason: "UNSUPPORTED_DOMAIN", message: "Chỉ đọc trang sản phẩm HTTPS Shopee/TikTok Shop" };
  const path = url.pathname.toLowerCase();
  const pageText = String(doc.title || "").toLowerCase();
  const has = (selector) => Boolean(doc.querySelector(selector));
  if (/\/login|\/sign[\-_]?in|\/user\/login/.test(path) || has('input[type="password"]')) {
    return { ok: false, reason: "LOGIN_REQUIRED", message: "Phiên sàn cần đăng nhập lại trong app" };
  }
  if (/captcha|verify|challenge/.test(path) || has('iframe[src*="captcha"], [class*="captcha" i], [id*="captcha" i]') || /captcha|xác minh bạn là người/.test(pageText)) {
    return { ok: false, reason: "CAPTCHA_REQUIRED", message: "Trang yêu cầu xác minh thủ công; không tự vượt CAPTCHA" };
  }
  const text = (value, limit = 2500) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const getMeta = (selectors) => { for (const selector of selectors) { const node = doc.querySelector(selector); if (node?.content) return text(node.content); } return ""; };
  let product = {};
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent || "{}");
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      const nodes = roots.flatMap(v => Array.isArray(v?.["@graph"]) ? v["@graph"] : [v]);
      const found = nodes.find(v => /product/i.test(Array.isArray(v?.["@type"]) ? v["@type"].join(" ") : String(v?.["@type"] || "")));
      if (found) { product = found; break; }
    } catch { /* malformed JSON-LD is not fatal */ }
  }
  const title = getMeta(['meta[property="og:title"]','meta[name="twitter:title"]']) || text(product.name,500) || text(doc.querySelector("h1")?.textContent,500);
  const description = getMeta(['meta[property="og:description"]','meta[name="description"]']) || text(product.description) || text(doc.querySelector('[class*="description" i]')?.textContent);
  const images = [];
  const addImage = value => {
    if (typeof value === "object" && value) value = value.url || value.contentUrl;
    if (typeof value !== "string") return;
    try {
      const candidate = new URL(value, url.href);
      if (candidate.protocol !== "https:") return;
      // Skip tracking pixels, placeholders and obvious tiny icons when known from DOM.
      const normalized = candidate.href;
      if (!images.includes(normalized)) images.push(normalized);
    } catch { /* skip invalid links */ }
  };
  for (const v of (Array.isArray(product.image) ? product.image : [product.image])) addImage(v);
  for (const el of doc.querySelectorAll('meta[property="og:image"],meta[property="og:image:secure_url"],meta[name="twitter:image"]')) {
    const meta = /** @type {HTMLMetaElement} */ (el);
    addImage(meta.content);
  }
  const candidates = doc.querySelectorAll('main img, [class*="product" i] img, [class*="gallery" i] img, [class*="image" i] img, [data-testid*="image" i] img');
  for (const el of candidates) {
    const img = /** @type {HTMLImageElement} */ (el);
    if (img.naturalWidth && img.naturalWidth < 80) continue;
    if (img.naturalHeight && img.naturalHeight < 80) continue;
    addImage(img.currentSrc || img.src || img.getAttribute?.("data-src") || img.getAttribute?.("data-original"));
  }
  return {
    ok: Boolean(title), reason: title ? "OK" : "PRODUCT_NOT_FOUND",
    message: title ? "Đã nhận nội dung sản phẩm" : "Chưa tìm thấy tên sản phẩm trong DOM",
    url: url.origin + url.pathname,
    platform: h.includes("shopee") ? "shopee" : "tiktok-shop",
    title: text(title, 500), description: text(description, 2500), images: images.slice(0, 8),
    imageCount: Math.min(images.length, 8)
  };
}

function isAllowedProductUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && new Set(["shopee.vn", "www.shopee.vn", "tiktok.com", "www.tiktok.com", "shop.tiktok.com"]).has(u.hostname.toLowerCase());
  } catch { return false; }
}

// The extension extractor is the source of truth; injection runs inside the SAME
// WebContentsView that owns the user's already signed-in partition.
const { extractProductSnapshot: extractShopGrab } = require("../extension/shopee_grab.js");

function shopPlatformForUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (["shopee.vn", "www.shopee.vn"].includes(url.hostname.toLowerCase())) return "shopee";
    if (["tiktok.com", "www.tiktok.com", "shop.tiktok.com"].includes(url.hostname.toLowerCase())) return "tiktok";
  } catch { /* invalid */ }
  return null;
}

async function readProductFromWebContents(view, url, {
  minImages = 4, timeoutMs = 45_000, sessionReady = null, partialGraceMs = 4_000,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  const platform = shopPlatformForUrl(url);
  if (!platform) throw new Error("UNSUPPORTED_DOMAIN: link HTTPS sàn không hợp lệ");
  const contents = view?.webContents;
  if (!contents || typeof contents.executeJavaScript !== "function" || typeof contents.loadURL !== "function")
    throw new Error("LOGIN_REQUIRED: chưa mở WebContentsView phiên sàn trong ứng dụng");
  const current = typeof contents.getURL === "function" ? String(contents.getURL() || "") : "";
  if (sessionReady === false || !current || /^(about:blank|file:|chrome:)/i.test(current) ||
      shopPlatformForUrl(current) !== platform)
    throw new Error("LOGIN_REQUIRED: không có WebContentsView cùng sàn đã đăng nhập");
  const deadline = Date.now() + Math.min(45_000, Math.max(1, timeoutMs));
  const until = async (work, phase) => {
    const wait = deadline - Date.now();
    if (wait <= 0) throw new Error(`TIMEOUT: quá hạn 45 giây (${phase})`);
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(work),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`TIMEOUT: quá hạn 45 giây (${phase})`)), wait); })
      ]);
    } finally { clearTimeout(timer); }
  };
  if (current !== url) {
    try { await until(() => contents.loadURL(url), "navigation"); }
    catch (error) { throw new Error(/^TIMEOUT/.test(error.message) ? error.message : `NAVIGATION_FAILED: ${error.message}`); }
  }
  const script = `(${extractShopGrab.toString()})(document, location.href)`;
  let last;
  let partialSince = null;
  while (Date.now() < deadline) {
    let result;
    try { result = await until(() => contents.executeJavaScript(script, true), "DOM"); }
    catch (error) { throw new Error(/^TIMEOUT/.test(error.message) ? error.message : `DOM_READ_FAILED: ${error.message}`); }
    if (!result || typeof result !== "object") throw new Error("DOM_READ_FAILED: dữ liệu DOM không hợp lệ");
    last = result;
    const code = result.reason === "CAPTCHA" ? "CAPTCHA_REQUIRED" : result.reason;
    if (["LOGIN_REQUIRED", "CAPTCHA_REQUIRED", "UNSUPPORTED_DOMAIN"].includes(code))
      throw new Error(`${code}: ${result.message || "Trang sàn chưa sẵn sàng"}`);
    if (result.ok && Array.isArray(result.images) && result.images.length >= minImages && result.description)
      return { ...result, imageCount: result.images.length };
    if (result.title && result.description && Array.isArray(result.images) && result.images.length < minImages) {
      if (partialSince === null) partialSince = Date.now();
      if (Date.now() - partialSince >= partialGraceMs)
        throw new Error(`INSUFFICIENT_IMAGES: chỉ có ${result.images.length} ảnh / yêu cầu ${minImages}`);
    } else partialSince = null;
    await until(() => pause(Math.min(350, Math.max(1, deadline - Date.now()))), "DOM wait");
  }
  if (last?.title && last?.description && Array.isArray(last.images) && last.images.length < minImages)
    throw new Error(`INSUFFICIENT_IMAGES: chỉ có ${last.images.length} ảnh / yêu cầu ${minImages}`);
  throw new Error(`TIMEOUT: không đọc được sản phẩm trong 45 giây (${last?.message || "chưa sẵn sàng"})`);
}

module.exports = { extractProductSnapshot, isAllowedProductUrl, readProductFromWebContents, shopPlatformForUrl };