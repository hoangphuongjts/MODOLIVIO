"use strict";

const PORTS = Array.from({ length: 10 }, (_, i) => 19740 + i);
async function findBridge(path) {
  for (const port of PORTS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: "OPTIONS", headers: { Origin: location.origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
      if (response.status === 204) return port;
    } catch { /* try next allowed local port */ }
  }
  throw new Error("MODOLIVIO Bridge Agent chưa chạy");
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "PRODUCT_SNAPSHOT") return false;
  (async () => {
    const { accessToken, refreshToken, port } = await chrome.storage.local.get(["accessToken", "refreshToken", "port"]);
    if (!accessToken || !refreshToken || !port) throw new Error("Hãy ghép nối Bridge Agent từ cửa sổ extension trước");
    const response = await fetch(`http://127.0.0.1:${port}/v1/products/import`, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(message.product),
    });
    if (response.status === 401) {
      const renewed = await fetch(`http://127.0.0.1:${port}/v1/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) });
      if (!renewed.ok) throw new Error("Phiên Bridge hết hạn; hãy ghép nối lại");
      const tokens = await renewed.json(); await chrome.storage.local.set(tokens);
      return sendResponse(await importProduct(port, tokens.accessToken, message.product));
    }
    if (!response.ok) throw new Error((await response.json()).error || `Bridge lỗi ${response.status}`);
    sendResponse({ ok: true, result: await response.json() });
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
async function importProduct(port, accessToken, product) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/products/import`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(product) });
  if (!response.ok) throw new Error((await response.json()).error || `Bridge lỗi ${response.status}`);
  return { ok: true, result: await response.json() };
}
