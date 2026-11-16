"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CDP_PORTS, isMuseUrl, selectMuseTarget, validLocalWebSocket, INSPECTION_JS, run } = require("../tools/muse-cdp-dom-dump.js");

test("CDP connects only to muse.ai pages and localhost ports 19750..19759", () => {
  assert.equal(CDP_PORTS.length, 10);
  assert.equal(isMuseUrl("https://muse.ai/chat"), true);
  assert.equal(isMuseUrl("https://evil-muse.ai/chat"), false);
  assert.equal(isMuseUrl("https://muse.ai.attacker.net"), false);
  assert.equal(validLocalWebSocket("ws://127.0.0.1:19750/devtools/page/123", 19750), true);
  assert.equal(validLocalWebSocket("ws://10.0.0.2:19750/devtools/page/123", 19750), false);
  assert.equal(validLocalWebSocket("ws://127.0.0.1:19740/devtools/page/123", 19750), false);
  assert.equal(selectMuseTarget([{ type: "page",url:"https://example.org",webSocketDebuggerUrl:"ws://127.0.0.1:19750/devtools/page/a" },{ type:"page",url:"https://muse.ai",webSocketDebuggerUrl:"ws://127.0.0.1:19750/devtools/page/b" }]).url, "https://muse.ai");
});

test("CDP inspector checks every data-testid but never reads cookies or input values", () => {
  assert.match(INSPECTION_JS, /querySelectorAll\('\[data-testid\]'\)/);
  assert.match(INSPECTION_JS, /hatch-composer-stop-button/);
  assert.doesNotMatch(INSPECTION_JS, /document\.cookie|localStorage|sessionStorage|\.value\b/);
});

test("CDP probe writes a report from a mock local tab", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "mo-cdp-")); t.after(() => fs.rmSync(folder, {recursive:true, force:true}));
  const out = path.join(folder, "dom.json");
  let calls=0;
  const result=await run({ out,
    fetchImpl: async (url) => {
      calls++;
      return { ok: true, json: async () => url.includes("19750") ? [{type:"page",url:"https://muse.ai/chat",webSocketDebuggerUrl:"ws://127.0.0.1:19750/devtools/page/1"}] : [] };
    },
    cdpCall: async () => ({ allTestIds: [{ testid: "native-auth-access-pane" }], totalTestIdElements: 1, summary: {loginRequired:true} }) });
  assert.equal(calls,1);
  assert.equal(result.port,19750);
  assert.equal(JSON.parse(fs.readFileSync(out)).summary.loginRequired,true);
});
