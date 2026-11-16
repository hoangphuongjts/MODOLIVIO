#!/usr/bin/env node
"use strict";

// Read-only DOM inspection. This never submits prompts, reads cookies or changes extensions.
// Requires existing Chrome remote debugging on 127.0.0.1:19750..19759.
const fs = require("fs");
const path = require("path");

const CDP_PORTS = Object.freeze(Array.from({ length: 10 }, (_, i) => 19750 + i));
function isMuseUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && (u.hostname === "muse.ai" || u.hostname.endsWith(".muse.ai")); }
  catch { return false; }
}
function selectMuseTarget(targets) {
  return targets.find((t) => t.type === "page" && isMuseUrl(t.url) && typeof t.webSocketDebuggerUrl === "string") || null;
}
function validLocalWebSocket(value, port) {
  try { const url = new URL(value); return url.protocol === "ws:" && new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname) && Number(url.port) === port && url.pathname.startsWith("/devtools/page/"); }
  catch { return false; }
}

const INSPECTION_JS = String.raw`(() => {
  const keep = (s, n=180) => String(s || "").trim().slice(0,n);
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    testid: el.getAttribute("data-testid") || "",
    className: keep(el.getAttribute("class"), 300),
    role: el.getAttribute("role") || "",
    ariaLabel: keep(el.getAttribute("aria-label"), 140),
    placeholder: keep(el.getAttribute("placeholder"), 140),
    title: keep(el.getAttribute("title"), 140),
    type: el.getAttribute("type") || "",
    disabled: !!el.disabled
  });
  const selectors = [
    'textarea', '[data-testid="native-auth-access-pane"]',
    '[data-testid="hatch-status-panel-sliding-surface"]',
    '[data-testid="hatch-composer-stop-button"]',
    '[data-testid^="hatch-chat-attachment-presentation-"]',
    '.hatch-agent-bubble-bg',
    'input[type="file"]', '[contenteditable="true"]',
    'button[aria-label*="Attach" i]', 'button[aria-label*="Stop" i]'
  ];
  const selectorResults = Object.fromEntries(selectors.map((s) => {
    let matches=[];
    try { matches = [...document.querySelectorAll(s)]; } catch(_) {}
    return [s, { count: matches.length, elements: matches.slice(0,15).map(describe) }];
  }));
  const allTestIds = [...document.querySelectorAll('[data-testid]')].map(describe);
  const composerCandidates = [...document.querySelectorAll('textarea, [contenteditable="true"], input[type="file"],button')]
    .filter(el => el.matches('textarea,[contenteditable="true"],input[type="file"]') || /attach|stop|đính kèm|dừng|upload|add/i.test([el.getAttribute('aria-label'),el.getAttribute('title'),el.textContent].join(' ')))
    .slice(0,100).map(describe);
  return {
    pageOrigin: location.origin, pagePath: location.pathname, pageTitle: keep(document.title,100),
    totalTestIdElements: allTestIds.length, allTestIds, selectorResults, composerCandidates,
    summary: {
      loginRequired: !!document.querySelector('[data-testid="native-auth-access-pane"]'),
      generating: !!document.querySelector('[data-testid="hatch-composer-stop-button"]'),
      statusPanelPresent: !!document.querySelector('[data-testid="hatch-status-panel-sliding-surface"]'),
      chatBubbleCount: document.querySelectorAll('.hatch-agent-bubble-bg').length,
      attachmentCount: document.querySelectorAll('[data-testid^="hatch-chat-attachment-presentation-"]').length
    }
  };
})()`;

async function callCdp(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  try {
    const packet = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP timeout (15 giây)")), 15000);
      ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: INSPECTION_JS, returnByValue: true, awaitPromise: false } })), { once: true });
      ws.addEventListener("message", ({ data }) => {
        let value; try { value = JSON.parse(data); } catch { return; }
        if (value.id !== 1) return;
        clearTimeout(timer);
        if (value.error || value.result?.exceptionDetails) reject(new Error("CDP Runtime.evaluate failed"));
        else resolve(value.result?.result?.value);
      });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP WebSocket error")); }, { once: true });
    });
    if (!packet || !Array.isArray(packet.allTestIds)) throw new Error("CDP trả dữ liệu DOM không hợp lệ");
    return packet;
  } finally { ws.close(); }
}

async function run({ out = path.resolve(process.cwd(), "muse-dom-inspection.json"), fetchImpl = fetch, cdpCall = callCdp } = {}) {
  const attempted=[];
  for(const port of CDP_PORTS) {
    let tabs;
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      tabs = await response.json();
    } catch(err) { attempted.push({ port, error: "Không kết nối được CDP" }); continue; }
    const tab = Array.isArray(tabs) ? selectMuseTarget(tabs) : null;
    if (!tab) { attempted.push({ port, error: "Không có tab muse.ai trong phiên CDP" }); continue; }
    if (!validLocalWebSocket(tab.webSocketDebuggerUrl, port)) {
      attempted.push({ port, error: "CDP WebSocket không thuộc localhost/cổng hợp lệ" }); continue;
    }
    const dom = await cdpCall(tab.webSocketDebuggerUrl);
    const report = { checkedAt: new Date().toISOString(), cdpPort: port, ...dom };
    fs.writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600 });
    return { port, out, summary: report.summary, count: report.totalTestIdElements };
  }
  throw new Error("Không có Chrome CDP + tab muse.ai hợp lệ ở 19750–19759. " + attempted.map(x => `${x.port}: ${x.error}`).join("; "));
}

if(require.main === module) {
  const option = process.argv.find(v => v.startsWith("--out="));
  run({ out: option ? path.resolve(option.slice(6)) : undefined })
    .then(result => process.stdout.write(JSON.stringify(result, null, 2) + "\n"))
    .catch(err => { process.stderr.write(String(err.message) + "\n"); process.exitCode = 1; });
}
module.exports = { CDP_PORTS, isMuseUrl, selectMuseTarget, validLocalWebSocket, INSPECTION_JS, run };
