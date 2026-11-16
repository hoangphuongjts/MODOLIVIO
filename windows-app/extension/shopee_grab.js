"use strict";

// Reads visible/product metadata only. No cookies, login data, CAPTCHA or
// authentication bypass is collected or automated.
function extractProductSnapshot(doc = document, href = location.href) {
  const url = new URL(href);
  const host = url.hostname.toLowerCase();
  const shopee = ["shopee.vn", "www.shopee.vn", "s.shopee.vn", "vn.shp.ee"].includes(host);
  const tiktok = ["shop.tiktok.com", "www.tiktok.com", "tiktok.com"].includes(host);
  if (url.protocol !== "https:" || (!shopee && !tiktok)) throw new Error("Trang hiện tại không thuộc Shopee/TikTok Shop được hỗ trợ");
  const meta = (selector) => doc.querySelector(selector)?.content?.trim() || "";
  let structured = {};
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent || "{}");
      const candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
      structured = candidates.find((item) => /product/i.test(String(item["@type"] || ""))) || structured;
    } catch { /* ignore malformed merchant JSON-LD and continue through page layers */ }
  }
  const domTitle = doc.querySelector("h1")?.textContent?.trim() || "";
  const title = meta('meta[property="og:title"]') || structured.name || domTitle || doc.title;
  const structuredImage = typeof structured.image === "string" ? structured.image : Array.isArray(structured.image) ? structured.image[0] : structured.image?.url;
  const imageUrl = meta('meta[property="og:image"]') || structuredImage || doc.querySelector("img[data-testid*='image'], img[class*='product']")?.src || "";
  const description = meta('meta[property="og:description"]') || structured.description || doc.querySelector("[class*='description']")?.textContent?.trim() || "";
  return { url: url.href, title: String(title || "").replace(/\s+/g, " ").slice(0, 500), imageUrl: String(imageUrl || "").slice(0, 2000),
    description: String(description || "").replace(/\s+/g, " ").slice(0, 2000), platform: shopee ? "shopee" : "tiktok-shop" };
}

if (typeof module !== "undefined") module.exports = { extractProductSnapshot };
if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
  try { chrome.runtime.sendMessage({ type: "PRODUCT_SNAPSHOT", product: extractProductSnapshot() }); } catch { /* unsupported page */ }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "EXTRACT") return false;
    try {
      const product = extractProductSnapshot();
      chrome.runtime.sendMessage({ type: "PRODUCT_SNAPSHOT", product }, (result) => sendResponse(result));
    } catch (error) { sendResponse({ ok: false, error: error.message }); }
    return true;
  });
}
