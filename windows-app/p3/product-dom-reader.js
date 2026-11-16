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
    return { ok: false, reason: "CAPTCHA", message: "Trang yêu cầu xác minh thủ công; không tự vượt CAPTCHA" };
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

async function readProductFromWebContents(view, url, { minImages = 4, timeoutMs = 20_000, pause = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (!isAllowedProductUrl(url)) throw new Error("UNSUPPORTED_DOMAIN: URL sản phẩm không hợp lệ");
  const contents = view?.webContents;
  if (!contents || typeof contents.executeJavaScript !== "function" || typeof contents.loadURL !== "function") throw new Error("WEBVIEW_UNAVAILABLE: cần WebContentsView đã có phiên đăng nhập sàn");
  if (!contents.getURL || contents.getURL() !== url) {
    try {
      await Promise.race([
        contents.loadURL(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT: tải trang sản phẩm quá hạn")), timeoutMs))
      ]);
    } catch(err) { throw new Error(/^TIMEOUT/.test(err.message) ? err.message : `NAVIGATION_FAILED: ${err.message}`); }
  }
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    let result;
    try { result = await contents.executeJavaScript(`(${extractProductSnapshot.toString()})(document, location.href)`, true); }
    catch(err) { throw new Error(`DOM_READ_FAILED: ${err.message}`); }
    last = result;
    if (result.reason === "LOGIN_REQUIRED" || result.reason === "CAPTCHA" || result.reason === "UNSUPPORTED_DOMAIN") throw new Error(`${result.reason}: ${result.message}`);
    if (result.ok && result.images.length >= minImages && result.description) return result;
    await pause(500);
  }
  if (!last?.ok) throw new Error(`TIMEOUT: ${last?.message || "Trang chưa tải xong"}`);
  throw new Error(`INSUFFICIENT_PRODUCT_DATA: chỉ có ${last.images?.length || 0} ảnh / yêu cầu ${minImages}, mô tả ${last.description ? "có" : "thiếu"}`);
}

module.exports = { extractProductSnapshot, isAllowedProductUrl, readProductFromWebContents };
