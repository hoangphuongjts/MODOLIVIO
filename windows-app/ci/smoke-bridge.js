"use strict";
// CI smoke only: real local HTTP + ephemeral SQLite; mock render provider, no external calls.
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { createBridgeAgent, PORTS } = require("../p3/bridge-agent.js");

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "modolivio-bridge-smoke-"));
  let agent;
  const origin = "http://127.0.0.1:19739";
  try {
    agent = await createBridgeAgent({
      dataDir, allowedOrigins: [origin],
      provider: { async submit() { throw new Error("CI: video generation disabled"); }, async getTask() { throw new Error("CI: video generation disabled"); } },
      tts: { async synthesize() { throw new Error("CI: audio generation disabled"); } },
      verifyFaceLock: () => false,
      verifyProductIdentity: () => false,
    });
    assert.ok(PORTS.includes(agent.port), `Port ${agent.port} outside 19740–19749`);
    const base = `http://127.0.0.1:${agent.port}`;
    const headers = { Origin: origin, Host: `127.0.0.1:${agent.port}`, "Content-Type": "application/json" };
    const forbidden = await fetch(`${base}/v1/bridge/status`, { headers: { ...headers, Origin: "https://untrusted.invalid" } });
    assert.equal(forbidden.status, 403, "Cross-origin request was accepted");
    const pair = await fetch(`${base}/v1/auth/pair`, { method: "POST", headers, body: JSON.stringify({ code: agent.pairingCode }) });
    assert.equal(pair.status, 200, `Pairing HTTP ${pair.status}`);
    const creds = await pair.json();
    const status = await fetch(`${base}/v1/bridge/status`, { headers: { ...headers, Authorization: `Bearer ${creds.accessToken}` } });
    assert.equal(status.status, 200, `Bridge status HTTP ${status.status}`);
    const payload = await status.json();
    assert.equal(payload.workerConcurrency, 1);
    console.log(JSON.stringify({ verdict: "PASS", port: agent.port, httpStatus: status.status, workerConcurrency: payload.workerConcurrency, mode: "mock-provider-no-Muse-login" }));
  } finally {
    if (agent) await agent.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.stack || String(error)); process.exitCode = 1; });
