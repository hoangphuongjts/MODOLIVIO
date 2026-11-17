"use strict";

// One source of truth for DOM extraction in an already authenticated shop WebContentsView.
// No cookies, localStorage, tokens, price, clipboard, CAPTCHA bypass, or network fetches.
function extractProductSnapshot(doc = document, href = location.href) {
  const page = new URL(href);
  const host = page.hostname.toLowerCase();
  const shopee = host === "shopee.vn" || host === "www.shopee.vn";
  const tiktok = ["shop.tiktok.com", "www.tiktok.com", "tiktok.com"].includes(host);
  const fail = (reason, message) => ({ ok: false, reason, message, title: "", description: "", imageUrl: "", images: [], imageCount: 0 });
  if (page.protocol !== "https:" || !(shopee || tiktok) || page.username || page.password)
    return fail("UNSUPPORTED_DOMAIN", "Chỉ hỗ trợ trang sản phẩm HTTPS Shopee/TikTok Shop");
  const pathName = page.pathname.toLowerCase();
  const titleText = String(doc.title || "").toLowerCase();
  const has = (sel) => Boolean(doc.querySelector(sel));
  if (/\/login|\/sign[-_]?in|\/user\/login/.test(pathName) || has('input[type="password"]'))
    return fail("LOGIN_REQUIRED", "Phiên sàn cần đăng nhập lại ngay trong cửa sổ MODOLIVIO");
  if (/captcha|verify|challenge/.test(pathName) ||
      has('iframe[src*="captcha"], [class*="captcha" i], [id*="captcha" i]') ||
      /captcha|xác minh bạn là người/.test(titleText))
    return fail("CAPTCHA_REQUIRED", "Yêu cầu người dùng xác minh thủ công; không tự vượt CAPTCHA");
  const clean = (value, n = 2500) => String(value || "").replace(/\s+/g, " ").trim().slice(0, n);
  const meta = (query) => clean(doc.querySelector(query)?.content || "");
  let structured = {};
  for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(node.textContent || "{}");
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      const candidates = roots.flatMap(v => Array.isArray(v?.["@graph"]) ? v["@graph"] : [v]);
      const product = candidates.find(v => /product/i.test(String(v?.["@type"] || "")));
      if (product) { structured = product; break; }
    } catch { /* malformed structured data: use visible DOM */ }
  }
  const title = meta('meta[property="og:title"]') || clean(structured.name, 500) ||
    clean(doc.querySelector("h1")?.textContent, 500);
  const description = meta('meta[property="og:description"]') || meta('meta[name="description"]') ||
    clean(structured.description) || clean(doc.querySelector('[class*="description" i]')?.textContent);
  const images = [];
  const keys = new Set();
  const addImage = (raw, width = 0, height = 0) => {
    if (Array.isArray(raw)) { for (const v of raw) addImage(v); return; }
    if (raw && typeof raw === "object") raw = raw.url || raw.contentUrl;
    if (typeof raw !== "string" || !raw) return;
    try {
      const url = new URL(raw, page.href);
      if (url.protocol !== "https:" || url.username || url.password) return;
      // VMX rule: strip Shopee thumbnail suffix, retaining the original image path.
      const oldPath = url.pathname;
      url.pathname = url.pathname.replace(/_tn(?=\.(?:png|jpe?g|webp|avif)$|$)/i, "")
        .replace(/@resize_w\d+[^/.]*/i, "");
      // Reject unrelated 1x1 icons, but accept a Shopee thumbnail upgraded to full size.
      if (width && width < 120 && !/_tn(?=\.|$)/i.test(oldPath)) return;
      if (height && height < 80 && !/_tn(?=\.|$)/i.test(oldPath)) return;
      const key = url.origin + url.pathname;
      if (keys.has(key) || images.length >= 8) return;
      keys.add(key); images.push(url.href);
    } catch { /* ignore non-URL images */ }
  };
  addImage(structured.image);
  for (const n of doc.querySelectorAll('meta[property="og:image"],meta[property="og:image:secure_url"],meta[name="twitter:image"]'))
    addImage((/** @type {HTMLMetaElement} */ (n)).content);
  for (const element of doc.querySelectorAll('main img, [class*="product" i] img, [class*="gallery" i] img, [class*="image" i] img, img')) {
    const img = /** @type {HTMLImageElement} */ (element);
    addImage(img.currentSrc || img.src || img.getAttribute?.("data-src") || img.getAttribute?.("data-original"), img.naturalWidth || 0, img.naturalHeight || 0);
  }
  return {
    ok: Boolean(title && description), reason: title && description ? "OK" : "PRODUCT_NOT_FOUND",
    message: title && description ? "Đã đọc dữ liệu sản phẩm" : "Chưa đủ tên/mô tả sản phẩm",
    url: page.origin + page.pathname, platform: shopee ? "shopee" : "tiktok-shop",
    title: clean(title, 500), description: clean(description, 2500), imageUrl: images[0] || "",
    images, imageCount: images.length,
  };
}

if (typeof module !== "undefined") module.exports = { extractProductSnapshot };
// Existing extension compatibility: a content script can still supply a snapshot.
const extensionChrome = /** @type {any} */ (globalThis).chrome;
if (extensionChrome?.runtime?.onMessage) {
  if (extensionChrome.runtime?.sendMessage) {
    try { extensionChrome.runtime.sendMessage({ type: "PRODUCT_SNAPSHOT", product: extractProductSnapshot() }); }
    catch { /* outside a supported product page */ }
  }
  extensionChrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "EXTRACT") return false;
    try { sendResponse({ ok: true, product: extractProductSnapshot() }); }
    catch (error) { sendResponse({ ok: false, error: String(error.message || error) }); }
    return false;
  });
}