"use strict";

const http = require("http");
const { randomBytes, timingSafeEqual } = require("crypto");
const { WebSocketServer } = require("ws");
const { JobQueue } = require("./job-queue.js");
const { SeedanceProvider, LocalTts } = require("./providers.js");
const { RenderPipeline } = require("./pipeline.js");
const { chooseRenderRoute } = require("./router.js");
const { AccountSafetyController } = require("./account-safety.js");

const PORTS = Object.freeze(Array.from({ length: 10 }, (_, i) => 19740 + i));
const ACCESS_TTL_MS = 60 * 60 * 1000;
function token() { return randomBytes(32).toString("base64url"); }
function constantTimeEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function allowedOriginSet(extra = []) {
  const configured = (process.env.MODOLIVIO_BRIDGE_ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
  return new Set([...configured, ...extra]);
}
function hostIsLoopback(hostHeader, port) {
  if (typeof hostHeader !== "string") return false;
  return hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}` || hostHeader === `[::1]:${port}`;
}
function bearer(req) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}
function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data), "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(data);
}
async function readJson(req, limit = 2_000_000) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw new Error("Yêu cầu vượt giới hạn kích thước");
  }
  return JSON.parse(body || "{}");
}
function listenOnPort(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.removeListener("listening", onListen); reject(error); };
    const onListen = () => { server.removeListener("error", onError); resolve(); };
    server.once("error", onError); server.once("listening", onListen);
    server.listen(port, "127.0.0.1");
  });
}

async function createBridgeAgent({ dataDir, allowedOrigins, provider = new SeedanceProvider(), tts = new LocalTts(), diskFreeBytes, emit = /** @type {(event: any) => void} */ (() => {}), verifyFaceLock, faceLockGate, verifyProductIdentity }) {
  const fs = require("fs"); const path = require("path");
  fs.mkdirSync(dataDir, { recursive: true });
  const queue = new JobQueue(path.join(dataDir, "p3-bridge.sqlite"));
  const safety = new AccountSafetyController({ db: queue.db, logFile: path.join(dataDir, "safety-alerts.jsonl"),
    onTrip: (event) => emit({ type: "safety-alert", ...event }) });
  const pipeline = new RenderPipeline({ queue, provider, tts, cacheDir: path.join(dataDir, "cache"), exportsDir: path.join(dataDir, "exports"), onEvent: emit, verifyFaceLock, faceLockGate, verifyProductIdentity,
    assertProfileAllowed: (profileId) => safety.assertCanContinue(profileId) });
  const accessTokens = new Map(); const refreshTokens = new Map(); const refreshByAccess = new Map(); let pairingCode = randomBytes(6).toString("hex");
  let port = 0; let heartbeatAt = Date.now();
  const originSet = allowedOriginSet(allowedOrigins);
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const remote = req.socket.remoteAddress;
    if (!new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).has(remote) || !hostIsLoopback(req.headers.host, port)) return send(res, 403, { error: "Bridge chỉ chấp nhận loopback; Host không hợp lệ" });
    if (!origin || !originSet.has(origin)) return send(res, 403, { error: "Thiếu Origin hoặc Origin chưa được cho phép" });
    if (req.method === "OPTIONS") {
      if (!origin || !originSet.has(origin)) return send(res, 403, { error: "Origin chưa được cho phép" });
      res.writeHead(204, { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key", "access-control-max-age": "300", vary: "Origin" });
      return res.end();
    }
    res.setHeader("access-control-allow-origin", origin); res.setHeader("vary", "Origin");
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    try {
      if (req.method === "POST" && url.pathname === "/v1/auth/pair") {
        const body = await readJson(req, 4096);
        if (!pairingCode || !constantTimeEquals(body.code, pairingCode)) return send(res, 401, { error: "Pairing code không hợp lệ hoặc đã dùng" });
        pairingCode = null;
        const access = token(); const refresh = token();
        accessTokens.set(access, { expiresAt: Date.now() + ACCESS_TTL_MS, profileId: null }); refreshTokens.set(refresh, null); refreshByAccess.set(access, refresh);
        return send(res, 200, { accessToken: access, expiresIn: 3600, refreshToken: refresh });
      }
      if (req.method === "POST" && url.pathname === "/v1/auth/refresh") {
        const body = await readJson(req, 4096);
        if (!refreshTokens.has(body.refreshToken)) return send(res, 401, { error: "Refresh token không hợp lệ hoặc đã dùng" });
        const profileId = refreshTokens.get(body.refreshToken);
        refreshTokens.delete(body.refreshToken);
        const access = token(); const refresh = token();
        accessTokens.set(access, { expiresAt: Date.now() + ACCESS_TTL_MS, profileId }); refreshTokens.set(refresh, profileId); refreshByAccess.set(access, refresh);
        return send(res, 200, { accessToken: access, expiresIn: 3600, refreshToken: refresh });
      }
      const accessToken = bearer(req);
      const accessRecord = accessTokens.get(accessToken);
      if (!accessRecord || accessRecord.expiresAt < Date.now()) return send(res, 401, { error: "Access token thiếu hoặc hết hạn" });
      if (req.method === "GET" && url.pathname === "/v1/bridge/status") {
        const free = typeof diskFreeBytes === "function" ? await diskFreeBytes(dataDir) : null;
        const routeInfo = chooseRenderRoute({ heartbeatAgeMs: Date.now() - heartbeatAt, diskFreeBytes: free ?? Infinity,
          localOffloadEnabled: process.env.MODOLIVIO_LOCAL_OFFLOAD === "1", lightweight: false });
        const selectedProfile = accessRecord.profileId || "default";
        const safetyStatus = safety.status(selectedProfile);
        const cloudFallback = routeInfo.reason === "cloud-fallback-condition" || Boolean(safetyStatus.circuitOpen);
        return send(res, 200, { port, queue: /** @type {any[]} */ (queue.list(100)).map((j) => ({ id: j.id, state: j.state })), workerConcurrency: 1,
          route: "cloud", routeReason: cloudFallback ? "safety-or-heartbeat-fallback" : routeInfo.reason, cloudFallback, diskFreeBytes: free, heartbeatAgeMs: Date.now() - heartbeatAt,
          safeMode: safety.safeMode, safety: safetyStatus });
      }
      if (req.method === "POST" && url.pathname === "/v1/bridge/heartbeat") { heartbeatAt = Date.now(); return send(res, 200, { ok: true }); }
      if (req.method === "POST" && url.pathname === "/v1/safety/signals") {
        const body = await readJson(req, 32 * 1024);
        if (!body.profileId || !body.type) return send(res, 400, { error: "profileId và signal type là bắt buộc" });
        const profileId = String(body.profileId);
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profileId)) return send(res, 400, { error: "profileId không hợp lệ" });
        if (!new Set(["401", "403", "login_required", "429", "captcha", "oidc_redirect", "suspect_die", "credit_exhausted_early", "prompt_rejected", "cookie_refresh", "still_sending", "slow_render", "slow_thread"]).has(String(body.type))) return send(res, 400, { error: "Signal type không được hỗ trợ" });
        if (accessRecord.profileId && accessRecord.profileId !== profileId) return send(res, 403, { error: "Token đã ghép với một profile khác" });
        if (!accessRecord.profileId) {
          accessRecord.profileId = profileId;
          const refresh = refreshByAccess.get(accessToken); if (refresh) refreshTokens.set(refresh, accessRecord.profileId);
        }
        return send(res, 200, safety.observe(profileId, String(body.type), body.detail || {}));
      }
      if (req.method === "POST" && url.pathname === "/v1/safety/clear") {
        const body = await readJson(req, 4096);
        if (!body.profileId || body.confirm !== true) return send(res, 400, { error: "Cần profileId và xác nhận người dùng" });
        const profileId = String(body.profileId);
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profileId)) return send(res, 400, { error: "profileId không hợp lệ" });
        if (accessRecord.profileId && accessRecord.profileId !== profileId) return send(res, 403, { error: "Token đã ghép với profile khác" });
        if (!accessRecord.profileId) {
          accessRecord.profileId = profileId;
          const refresh = refreshByAccess.get(accessToken); if (refresh) refreshTokens.set(refresh, profileId);
        }
        safety.clearByUser(profileId); return send(res, 200, { ok: true, safeMode: true });
      }
      if (req.method === "POST" && url.pathname === "/v1/products/import") {
        const body = await readJson(req, 128 * 1024);
        let productUrl;
        try { productUrl = new URL(body.url); } catch { return send(res, 400, { error: "URL sản phẩm không hợp lệ" }); }
        const host = productUrl.hostname.toLowerCase();
        const shopee = new Set(["shopee.vn", "www.shopee.vn", "s.shopee.vn", "vn.shp.ee"]).has(host);
        const tiktok = new Set(["shop.tiktok.com", "www.tiktok.com", "tiktok.com"]).has(host);
        if (productUrl.protocol !== "https:" || (!shopee && !tiktok)) return send(res, 422, { error: "Chỉ nhận URL HTTPS Shopee/TikTok Shop đã cho phép" });
        const fields = { title: String(body.title || "").slice(0, 500), imageUrl: String(body.imageUrl || "").slice(0, 2000), description: String(body.description || "").slice(0, 2000) };
        if (fields.imageUrl) {
          let image; try { image = new URL(fields.imageUrl); } catch { return send(res, 422, { error: "Ảnh sản phẩm URL không hợp lệ" }); }
          if (image.protocol !== "https:") return send(res, 422, { error: "Ảnh sản phẩm phải dùng HTTPS" });
        }
        queue.saveProduct({ canonicalUrl: productUrl.href, platform: shopee ? "shopee" : "tiktok-shop", ...fields, payload: { ...body, ...fields, url: productUrl.href } });
        return send(res, 201, { saved: true, platform: shopee ? "shopee" : "tiktok-shop", title: fields.title });
      }
      if (req.method === "GET" && url.pathname === "/v1/jobs") return send(res, 200, { jobs: queue.list(100) });
      if (req.method === "POST" && url.pathname === "/v1/jobs") {
        const payload = await readJson(req);
        const idempotencyKey = req.headers["idempotency-key"];
        if (!idempotencyKey) return send(res, 400, { error: "Thiếu Idempotency-Key" });
        const prior = queue.getByIdempotencyKey(idempotencyKey);
        if (prior) return send(res, 202, { id: prior.id, state: prior.state, idempotencyKey });
        pipeline.validate(payload);
        const profileId = String(payload.profileId || "");
        if (accessRecord.profileId && accessRecord.profileId !== profileId) return send(res, 403, { error: "Token đã ghép với profile khác; mỗi tài khoản chỉ dùng một profile" });
        if (!accessRecord.profileId) {
          accessRecord.profileId = profileId;
          const refresh = refreshByAccess.get(accessToken); if (refresh) refreshTokens.set(refresh, accessRecord.profileId);
        }
        try { safety.assertCanStart(profileId); }
        catch (error) { return send(res, 429, { error: error.message, safeMode: true }); }
        const job = await pipeline.enqueue(payload, idempotencyKey);
        setImmediate(() => pipeline.pump());
        return send(res, 202, { id: job.id, state: job.state, idempotencyKey });
      }
      return send(res, 404, { error: "Không tìm thấy endpoint" });
    } catch (error) { return send(res, error.message.includes("JSON") ? 400 : 422, { error: error.message }); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url || "/", "http://127.0.0.1").pathname !== "/v1/events") { socket.destroy(); return; }
    if (!hostIsLoopback(req.headers.host, port) || !new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).has(req.socket.remoteAddress) ||
      !req.headers.origin || !originSet.has(req.headers.origin)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws) => {
    const timer = setTimeout(() => ws.close(4401, "auth required"), 3000);
    ws.once("message", (message) => {
      let data;
      try { data = JSON.parse(message.toString()); } catch { ws.close(4400, "invalid message"); return; }
      const accessRecord = accessTokens.get(data.token);
      if (!accessRecord || accessRecord.expiresAt < Date.now()) { ws.close(4401, "unauthorized"); return; }
      clearTimeout(timer); ws.send(JSON.stringify({ type: "ready", port }));
      const expiryTimer = setTimeout(() => ws.close(4401, "token expired"), Math.max(1, accessRecord.expiresAt - Date.now()));
      const listener = (event) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event)); };
      wss.on("p3-event", listener); ws.once("close", () => { clearTimeout(expiryTimer); wss.off("p3-event", listener); });
    });
  });
  const publish = (event) => wss.emit("p3-event", event);
  const onPipelineEvent = pipeline.onEvent;
  pipeline.onEvent = (event) => { onPipelineEvent(event); publish(event); };
  let lastError;
  for (const candidate of PORTS) {
    try { await listenOnPort(server, candidate); port = candidate; break; }
    catch (error) { lastError = error; if (error.code !== "EADDRINUSE" && error.code !== "EACCES") throw error; }
  }
  if (!port) { queue.close(); throw new Error(`Không còn cổng Bridge 19740–19749: ${lastError?.message || "không rõ lỗi"}`); }
  const gcTimer = setInterval(() => {
    const cacheDir = path.join(dataDir, "cache");
    try {
      if (!fs.existsSync(cacheDir)) return;
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const retainedJobs = new Set(/** @type {any[]} */ (queue.list(500)).filter((job) => job.state === "queued" || job.state === "running").map((job) => job.id));
      for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if ([...retainedJobs].some((jobId) => entry.name.startsWith(`${jobId}-`))) continue;
        const filename = path.join(cacheDir, entry.name);
        if (fs.statSync(filename).mtimeMs < cutoff) fs.unlinkSync(filename);
      }
    } catch (error) { emit({ type: "maintenance", state: "cache-gc-error", message: error.message }); }
  }, 60 * 60 * 1000);
  gcTimer.unref?.();
  return {
    port, get pairingCode() { return pairingCode; }, queue, pipeline, safety,
    async close() { clearInterval(gcTimer); await pipeline.stop(); await new Promise((resolve) => wss.close(() => resolve())); await new Promise((resolve) => server.close(() => resolve())); queue.close(); },
  };
}

module.exports = { PORTS, ACCESS_TTL_MS, hostIsLoopback, allowedOriginSet, createBridgeAgent };
