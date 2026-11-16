"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { JobQueue } = require("../p3/job-queue.js");
const { createBridgeAgent, PORTS, hostIsLoopback } = require("../p3/bridge-agent.js");
const { MissingApiKeyError, SeedanceProvider } = require("../p3/providers.js");
const { validateJob, findVideoUrl } = require("../p3/pipeline.js");
const { chooseRenderRoute } = require("../p3/router.js");
const { MuseSessionVault } = require("../p3/session-vault.js");
const { SessionHealthMonitor, AutoReloginEngine } = require("../p3/session-health.js");
const { AccountSafetyController } = require("../p3/account-safety.js");
const { extractProductSnapshot } = require("../extension/shopee_grab.js");

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "modolivio-p3-")); }

test("Bridge chọn riêng dải 19740–19749, không nhận host thay thế", () => {
  assert.deepEqual(PORTS, [19740, 19741, 19742, 19743, 19744, 19745, 19746, 19747, 19748, 19749]);
  assert.equal(PORTS.includes(18638), false); assert.equal(PORTS.includes(18650), false);
  assert.equal(hostIsLoopback("127.0.0.1:19740", 19740), true);
  assert.equal(hostIsLoopback("attacker.example:19740", 19740), false);
  assert.equal(hostIsLoopback("127.0.0.1:18650", 19740), false);
});

test("SQLite WAL lưu idempotency và chỉ cho một job running", () => {
  const dir = tempDir(); const dbFile = path.join(dir, "queue.sqlite");
  let queue = new JobQueue(dbFile);
  assert.equal(queue.db.pragma("journal_mode", { simple: true }), "wal");
  const a = queue.enqueue({ id: "a", idempotencyKey: "key-a", payload: { value: 1 } });
  const duplicate = queue.enqueue({ id: "b", idempotencyKey: "key-a", payload: { value: 2 } });
  queue.enqueue({ id: "c", idempotencyKey: "key-c", payload: { value: 3 } });
  assert.equal(duplicate.id, a.id);
  assert.equal(queue.claimNext().id, "a");
  assert.equal(queue.claimNext(), null);
  queue.setProviderTask("a", "seedance-task-42");
  queue.close();
  queue = new JobQueue(dbFile);
  const recovered = queue.claimNext();
  assert.equal(recovered.id, "a", "recovery requeues interrupted job");
  assert.equal(recovered.provider_task_id, "seedance-task-42", "recovery keeps provider task id to prevent duplicate submission");
  queue.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test("hard gates reject unverified face lock, price text and overlays", () => {
  const base = { scenes: [{ durationSec: 10, sourceImageUrl: "https://assets.test/product.jpg", dialogue: "Sản phẩm này tiện dụng", caption: "", overlays: [] }] };
  assert.throws(() => validateJob(base), /Face Lock/);
  assert.throws(() => validateJob(base, () => true), /ảnh gốc/);
  const verified = (_scene) => true;
  assert.equal(validateJob(base, verified, verified), true);
  assert.throws(() => validateJob({ scenes: [{ ...base.scenes[0], dialogue: "Giá 100.000 đồng" }] }, verified, verified), /giá số/);
  assert.throws(() => validateJob({ scenes: [{ ...base.scenes[0], overlays: [{ type: "subtitle" }] }] }, verified, verified), /cấm mọi chữ/);
  assert.throws(() => validateJob({ scenes: [{ ...base.scenes[0], durationSec: 8 }] }, verified, verified), /đúng 10 giây/);
});

test("Seedance adapter fails closed without key and uses configured key in mock", async () => {
  const noKey = new SeedanceProvider({ apiKey: "", fetchImpl: async () => { throw new Error("must not call"); } });
  await assert.rejects(noKey.submit({ prompt: "test", durationSec: 10 }), MissingApiKeyError);
  let request;
  const provider = new SeedanceProvider({ apiKey: "mock-secret", fetchImpl: async (_url, options) => {
    request = options; return new Response(JSON.stringify({ id: "task-1" }), { status: 200 });
  } });
  assert.equal((await provider.submit({ prompt: "portrait", imageUrl: "https://assets.test/p.jpg", durationSec: 10 })).taskId, "task-1");
  assert.equal(request.headers.Authorization, "Bearer mock-secret");
  const sent = JSON.parse(request.body); assert.equal(sent.model, "dreamina-seedance-2-5-260628"); assert.equal(sent.ratio, "9:16");
});

test("Video URL parser only accepts explicit video_url fields", () => {
  assert.equal(findVideoUrl({ data: { content: [{ type: "video_url", video_url: { url: "https://cdn.test/a.mp4" } }] } }), "https://cdn.test/a.mp4");
  assert.equal(findVideoUrl({ id: "x", status: "succeeded" }), null);
});

test("render routing defaults to cloud and falls back to cloud on stale heartbeat or low disk", () => {
  assert.equal(chooseRenderRoute({}).route, "cloud");
  assert.equal(chooseRenderRoute({ localOffloadEnabled: true, lightweight: true }).route, "local-lightweight");
  assert.equal(chooseRenderRoute({ heartbeatAgeMs: 15001, localOffloadEnabled: true, lightweight: true }).route, "cloud");
  assert.equal(chooseRenderRoute({ diskFreeBytes: 2 * 1024 ** 3 - 1, localOffloadEnabled: true, lightweight: true }).route, "cloud");
});

test("MuseSessionVault uses AES-GCM, per-profile partition, and rejects cookies/weak storage", () => {
  const dir = tempDir();
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "dpapi",
    encryptString: (s) => Buffer.from(`wrapped:${s}`),
    decryptString: (b) => b.toString().replace(/^wrapped:/, ""),
  };
  const vault = new MuseSessionVault({ directory: dir, safeStorage }); vault.initialize();
  assert.equal(vault.partition("seller_1"), "persist:mo-muse-seller_1");
  vault.store("seller_1", { accessToken: "user-granted-token", refreshToken: "refresh-token", expiresAt: Date.now() + 60_000 });
  assert.equal(vault.read("seller_1").accessToken, "user-granted-token");
  assert.doesNotMatch(fs.readFileSync(path.join(dir, "muse-vault.json"), "utf8"), /user-granted-token/);
  assert.throws(() => vault.store("seller_1", { accessToken: "long-enough-token", cookie: "secret" }), /Cookies\/passwords/);
  assert.throws(() => new MuseSessionVault({ directory: dir, safeStorage: { ...safeStorage, getSelectedStorageBackend: () => "basic_text" } }).initialize(), /Unsafe safeStorage/);
  vault.lock(); fs.rmSync(dir, { recursive: true, force: true });
});

test("session health detects auth loss and supervised relogin stops after two prompts", async () => {
  let now = 10000; const signals = []; const opens = [];
  const monitor = new SessionHealthMonitor({ profileId: "p1", now: () => now, onInvalid: (signal) => signals.push(signal) });
  assert.equal(monitor.observeResponse({ status: 403, url: "https://muse.example/api" }), true);
  assert.equal(monitor.observeResponse({ status: 401, url: "https://muse.example/api" }), true);
  assert.equal(signals.length, 1, "debounce duplicate auth signals within 2 seconds");
  now += 2001; monitor.observeResponse({ status: 200, url: "https://muse.example/oidc/login" });
  assert.equal(signals.length, 2);
  const recovery = new AutoReloginEngine({ maxAttempts: 2, openUserSignIn: async (profileId) => opens.push(profileId) });
  assert.equal(await recovery.sessionInvalid("p1", "401"), true);
  assert.equal(await recovery.sessionInvalid("p1", "401"), true);
  assert.equal(await recovery.sessionInvalid("p1", "401"), false);
  assert.deepEqual(opens, ["p1", "p1"]);
});

test("Safe Mode enforces durable per-profile quotas and trips on risk signals", () => {
  const dir = tempDir(); const queue = new JobQueue(path.join(dir, "queue.sqlite")); let now = 5_000_000;
  const safety = new AccountSafetyController({ db: queue.db, logFile: path.join(dir, "alerts.jsonl"), now: () => now });
  for (let i = 0; i < 3; i++) safety.assertCanStart("p1");
  assert.throws(() => safety.assertCanStart("p1"), /hạn mức an toàn/);
  assert.equal(safety.observe("p2", "suspect_die").tripped, true);
  assert.equal(safety.status("p2").cooldownUntil, now + 2 * 60 * 60 * 1000);
  assert.throws(() => safety.assertCanStart("p2"), /Safe Mode đã dừng/);
  assert.equal(fs.readFileSync(path.join(dir, "alerts.jsonl"), "utf8").includes("CIRCUIT_BREAKER"), true);
  safety.clearByUser("p2"); queue.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test("Shopee/TikTok grabber prefers JSON-LD/OpenGraph/DOM and never extracts prices or cookies", () => {
  const doc = {
    title: "Fallback",
    querySelectorAll: () => [{ textContent: JSON.stringify({ "@type": "Product", name: "Áo mẫu", image: "https://cdn.test/product.jpg", offers: { price: "999" } }) }],
    querySelector: (selector) => selector === 'meta[property="og:title"]' ? null : selector === 'meta[property="og:image"]' ? null : selector === 'meta[property="og:description"]' ? null : selector === "h1" ? { textContent: "DOM title" } : null,
  };
  const product = extractProductSnapshot(doc, "https://shopee.vn/item/1");
  assert.equal(product.title, "Áo mẫu"); assert.equal(product.imageUrl, "https://cdn.test/product.jpg");
  assert.equal(Object.hasOwn(product, "price"), false); assert.equal(Object.hasOwn(product, "cookie"), false);
});

test("REST Bridge pairs once, enforces origin/token, and exposes one-worker status", async (t) => {
  const dir = tempDir();
  const agent = await createBridgeAgent({ dataDir: dir, allowedOrigins: ["chrome-extension://testid"], provider: { submit: async () => { throw new Error("mock provider stopped"); } }, tts: {}, diskFreeBytes: async () => 4 * 1024 ** 3, verifyFaceLock: () => true, verifyProductIdentity: () => true });
  t.after(async () => { await agent.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${agent.port}`;
  const call = (url, options = {}) => fetch(`${base}${url}`, { ...options, headers: { Origin: "chrome-extension://testid", Host: `127.0.0.1:${agent.port}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  const rejected = await fetch(`${base}/v1/bridge/status`, { headers: { Host: `127.0.0.1:${agent.port}`, Origin: "https://attacker.invalid" } });
  assert.equal(rejected.status, 403);
  const paired = await call("/v1/auth/pair", { method: "POST", body: JSON.stringify({ code: agent.pairingCode }) });
  assert.equal(paired.status, 200); const tokens = await paired.json();
  const secondPair = await call("/v1/auth/pair", { method: "POST", body: JSON.stringify({ code: agent.pairingCode }) });
  assert.equal(secondPair.status, 401);
  const status = await call("/v1/bridge/status", { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
  assert.equal(status.status, 200); const details = await status.json();
  assert.equal(details.workerConcurrency, 1); assert.equal(details.route, "cloud");
  const refreshed = await call("/v1/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
  assert.equal(refreshed.status, 200); const rotated = await refreshed.json();
  assert.equal((await call("/v1/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: tokens.refreshToken }) })).status, 401);
  assert.equal((await call("/v1/bridge/status", { headers: { Authorization: `Bearer ${rotated.accessToken}` } })).status, 200);
  const missing = await call("/v1/jobs", { headers: { Authorization: "Bearer wrong" } });
  assert.equal(missing.status, 401);
  const baseJob = { scenes: [{ durationSec: 10, sourceImageUrl: "https://assets.test/product.jpg", prompt: "A safe vertical product demo", dialogue: "Sản phẩm tiện dụng", overlays: [] }] };
  const started = await call("/v1/jobs", { method: "POST", headers: { Authorization: `Bearer ${rotated.accessToken}`, "Idempotency-Key": "profile-one" }, body: JSON.stringify({ ...baseJob, profileId: "seller-one" }) });
  assert.equal(started.status, 202);
  const anotherProfile = await call("/v1/jobs", { method: "POST", headers: { Authorization: `Bearer ${rotated.accessToken}`, "Idempotency-Key": "profile-two" }, body: JSON.stringify({ ...baseJob, profileId: "seller-two" }) });
  assert.equal(anotherProfile.status, 403, "paired token stays bound to one stable account profile");
});
