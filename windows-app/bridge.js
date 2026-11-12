// bridge.js — Cầu nối dữ liệu cục bộ cho MODOLIVIO Windows.
//
// Giao thức giống hệt @hatch/space-sdk phía client:
//   POST /actions  { action, args, actionCallId }  ->  { data: {...} } hoặc { error: "..." }
//
// PHẠM VI THẬT CỦA BẢN WINDOWS (không giả lập):
// - Đọc/liệt kê, tạo/sửa/xóa dữ liệu quản lý (dự án, nhân vật, giọng, sản phẩm,
//   đơn hàng, kho, tài chính, vận chuyển, khách hàng, khuyến mãi, nhân viên,
//   livestream, sàn, affiliate, mạng xã hội...) chạy hoàn toàn cục bộ, lưu vào
//   file JSON trong thư mục dữ liệu của app (%APPDATA%/MODOLIVIO).
// - Tải ảnh/nhạc/logo lên: lưu file thật vào thư mục uploads, trả URL cục bộ.
// - VieNeu-TTS: nếu máy chủ VieNeu-TTS đang chạy ở http://127.0.0.1:8000 thì
//   nghe thử / nhân bản giọng chạy thật qua API đó; chưa chạy thì báo rõ cách chạy.
// - Báo giá ship: tính thật từ bảng phí đơn vị vận chuyển đã lưu (sửa được).
// - Kiểm tra nội dung: quét từ cấm cục bộ.
// - Tính năng cần Muse AI phía máy chủ (Làm nhanh, viết kịch bản, tạo ảnh/clip,
//   Dịch ngược, gợi ý xu hướng...) TRẢ LỖI RÕ RÀNG bằng tiếng Việt, không bịa kết quả.
//
// Không dùng dependency ngoài: chỉ dùng module có sẵn của Node.js.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VIENEU_BASE = process.env.MODOLIVIO_VIENEU_URL || "http://127.0.0.1:8000";
const VIENEU_HINT =
  "Máy chủ VieNeu-TTS chưa chạy trên máy này. Chạy: cd <thư mục VieNeu-TTS> && uv run python -m apps.openai_speech (máy chủ ở http://127.0.0.1:8000), rồi thử lại.";
const AI_UNAVAILABLE =
  "Tính năng này cần Muse AI phía máy chủ (viết kịch bản, tạo ảnh/clip bằng AI). Bản Windows chạy cục bộ chưa có Muse AI — hãy dùng bản web MODOLIVIO để chạy bước này, rồi mở lại dự án trên bản Windows để quản lý tiếp.";

const DEFAULT_MIX = {
  voice: 100,
  music: 15,
  effects: 50,
  original: 100,
  muted: { voice: false, music: false, effects: false, original: false },
};

// Giọng mặc định của app (khớp bản web): Ngọc Lan — VieNeu-TTS v3 Turbo.
const DEFAULT_VOICE = {
  ref: "vieneu:Ngọc Lan",
  name: "Ngọc Lan",
  region: "hanoi",
  gender: "nu",
  speed: "vua",
  description: "Giọng VieNeu-TTS v3 Turbo 48 kHz — Bắc, nữ, trẻ trung năng động.",
  sampleLine: "Xin chào mọi người, hôm nay mình có một sản phẩm rất hay muốn giới thiệu.",
  engine: "vieneu",
  vieneuName: "Ngọc Lan",
};

// 18 giọng mẫu + Adam (khớp catalog của bản web) — dùng cho gợi ý giọng cục bộ.
const VOICE_PRESETS = [
  { ref: "adam-vi", name: "Adam – Dominant, Firm", region: "hanoi", gender: "nam", speed: "vua" },
  { ref: "hn-nu-nangdong", name: "Hà Nội · Nữ trẻ năng động", region: "hanoi", gender: "nu", speed: "nhanh" },
  { ref: "hn-nu-01", name: "Hà Nội · Nữ dịu dàng", region: "hanoi", gender: "nu", speed: "vua" },
  { ref: "hn-nu-02", name: "Hà Nội · Nữ trầm ấm tự tin", region: "hanoi", gender: "nu", speed: "vua" },
  { ref: "hn-nu-03", name: "Hà Nội · Nữ trung niên", region: "hanoi", gender: "nu", speed: "vua" },
  { ref: "hn-nam-01", name: "Hà Nội · Nam trẻ trung năng động", region: "hanoi", gender: "nam", speed: "nhanh" },
  { ref: "hn-nam-02", name: "Hà Nội · Nam trầm ấm tự tin", region: "hanoi", gender: "nam", speed: "vua" },
  { ref: "hn-nam-03", name: "Hà Nội · Nam dịu dàng", region: "hanoi", gender: "nam", speed: "vua" },
  { ref: "sg-nu-01", name: "Sài Gòn · Nữ trẻ trung năng động", region: "saigon", gender: "nu", speed: "nhanh" },
  { ref: "sg-nu-02", name: "Sài Gòn · Nữ dịu dàng", region: "saigon", gender: "nu", speed: "vua" },
  { ref: "sg-nu-03", name: "Sài Gòn · Nữ trầm ấm tự tin", region: "saigon", gender: "nu", speed: "vua" },
  { ref: "sg-nam-01", name: "Sài Gòn · Nam trẻ trung năng động", region: "saigon", gender: "nam", speed: "nhanh" },
  { ref: "sg-nam-02", name: "Sài Gòn · Nam dịu dàng", region: "saigon", gender: "nam", speed: "vua" },
  { ref: "sg-nam-03", name: "Sài Gòn · Nam trầm ấm tự tin", region: "saigon", gender: "nam", speed: "vua" },
  { ref: "mt-nu-01", name: "Miền Tây · Nữ trẻ trung năng động", region: "mientay", gender: "nu", speed: "nhanh" },
  { ref: "mt-nu-02", name: "Miền Tây · Nữ dịu dàng", region: "mientay", gender: "nu", speed: "vua" },
  { ref: "mt-nu-03", name: "Miền Tây · Nữ trầm ấm tự tin", region: "mientay", gender: "nu", speed: "vua" },
  { ref: "mt-nam-01", name: "Miền Tây · Nam trẻ trung năng động", region: "mientay", gender: "nam", speed: "nhanh" },
  { ref: "mt-nam-02", name: "Miền Tây · Nam dịu dàng", region: "mientay", gender: "nam", speed: "vua" },
  { ref: "mt-nam-03", name: "Miền Tây · Nam trầm ấm tự tin", region: "mientay", gender: "nam", speed: "vua" },
];

// Đơn vị vận chuyển mặc định (phí tham khảo, sửa được trong mục Giao vận).
const DEFAULT_CARRIERS = [
  { name: "GHN", baseFee: 16000, perKgFee: 4000, avgDays: 2, note: "Phí tham khảo — sửa được" },
  { name: "GHTK", baseFee: 15000, perKgFee: 3500, avgDays: 2, note: "Phí tham khảo — sửa được" },
  { name: "Viettel Post", baseFee: 14000, perKgFee: 3000, avgDays: 3, note: "Phí tham khảo — sửa được" },
  { name: "J&T Express", baseFee: 15000, perKgFee: 3500, avgDays: 2, note: "Phí tham khảo — sửa được" },
  { name: "Ninja Van", baseFee: 16000, perKgFee: 4000, avgDays: 3, note: "Phí tham khảo — sửa được" },
  { name: "Shopee Express", baseFee: 12000, perKgFee: 3000, avgDays: 2, note: "Phí tham khảo — sửa được" },
];

const COLLECTIONS = [
  "jobs", "products", "characters", "voices", "presets", "accounts",
  "series", "music", "posts", "backgrounds", "reverse", "feedback",
  "shops", "finance", "affiliateProducts", "affiliateLinks", "sampleRequests",
  "inventory", "stockMovements", "orders", "carriers", "shippers", "shipments",
  "liveSessions", "customers", "promotions", "staff", "socialAccounts",
  "abVariants", "schedules",
  // Tài khoản MODOLIVIO / Admin / key kích hoạt (khớp bản web, v1.1):
  "appUsers", "userPayments", "promoCodes", "appNotices", "licenseKeys", "usageLog",
  // Chat với Annie + Chatbot (khớp bản web v16 / 1.4.0):
  "annieMessages", "annieTasks", "chatbotSettings", "chatbotKnowledge", "chatbotConversations",
];

// Giá gói và tính năng theo gói mặc định (khớp bản web).
const DEFAULT_PLAN_PRICES = { free: 0, month: 99000, year: 790000 };
const PLAN_FEATURE_KEYS = ["lam-nhanh", "thu-cong", "phim-dai-tap", "dich-nguoc", "beat-studio", "ban-hang", "mxh"];
const DEFAULT_PLAN_FEATURES = {
  free: ["lam-nhanh", "thu-cong"],
  month: ["lam-nhanh", "thu-cong", "phim-dai-tap", "dich-nguoc", "ban-hang", "mxh"],
  year: [...PLAN_FEATURE_KEYS],
};

// Băm mật khẩu — THUẬT TOÁN GIỐNG HỆT BẢN WEB: SHA-256("modolivio:" + mật khẩu).
// Nhờ vậy tài khoản đăng ký bằng cùng email + mật khẩu ở bản web và bản Windows
// có cùng passHash, và file sao lưu đầy đủ mang được tài khoản sang máy khác.
function hashPassword(pw) {
  return crypto.createHash("sha256").update(`modolivio:${pw}`, "utf8").digest("hex");
}

// Key kích hoạt rút ngắn — giống hệt bản web: MO-XXXX-XXXX-XXXX, 12 ký tự
// (bảng chữ cái bỏ I/O/0/1 để khỏi nhầm), sinh ngẫu nhiên phía app.
const LICENSE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeLicenseKey() {
  const bytes = crypto.randomBytes(12);
  const chars = [...bytes].map((b) => LICENSE_ALPHABET[b % LICENSE_ALPHABET.length]);
  return `MO-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

function defaultStore() {
  const collections = {};
  for (const c of COLLECTIONS) collections[c] = [];
  collections.carriers = DEFAULT_CARRIERS.map((c, i) => ({ id: i + 1, ...c, delivered: 0, returned: 0, total: 0 }));
  return {
    version: 1,
    seq: {},
    settings: {
      defaultVoiceRef: "",
      volumes: { ...DEFAULT_MIX, muted: { ...DEFAULT_MIX.muted } },
      advancedTools: { musicgen: false, f5tts: false, xtts: false, insightface: false },
      logoUrl: "",
      modules: {},
      costConfig: { runsPerVideo: 8, pricePerRun: 0 },
      shippingSettings: { defaultSize: "20x15x10", defaultWeightKg: 0.5, pickupAddress: "", warehouseAddress: "" },
      plan: { plan: "free", planName: "Miễn phí", monthlyLimit: 3, payments: [] },
      planPrices: { ...DEFAULT_PLAN_PRICES },
      planFeatures: JSON.parse(JSON.stringify(DEFAULT_PLAN_FEATURES)),
      team: [],
    },
    collections,
  };
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.uploadsDir = path.join(dataDir, "uploads");
    this.file = path.join(dataDir, "modolivio-data.json");
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      this.data = JSON.parse(raw);
      if (!this.data.collections) this.data = defaultStore();
      for (const c of COLLECTIONS) if (!Array.isArray(this.data.collections[c])) this.data.collections[c] = [];
      if (!this.data.settings) this.data.settings = defaultStore().settings;
      if (!this.data.settings.planPrices) this.data.settings.planPrices = { ...DEFAULT_PLAN_PRICES };
      if (!this.data.settings.planFeatures) this.data.settings.planFeatures = JSON.parse(JSON.stringify(DEFAULT_PLAN_FEATURES));
      if (this.data.collections.carriers.length === 0) {
        this.data.collections.carriers = defaultStore().collections.carriers;
      }
    } catch {
      this.data = defaultStore();
      this.save();
    }
  }
  save() {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }
  nextId(collection) {
    const seq = this.data.seq || (this.data.seq = {});
    seq[collection] = (seq[collection] || 0) + 1;
    // Tránh trùng id với dữ liệu đã seed (carriers có id 1..6).
    const max = this.data.collections[collection].reduce((m, d) => Math.max(m, d.id || 0), 0);
    if (seq[collection] <= max) seq[collection] = max + 1;
    return seq[collection];
  }
  all(collection) { return this.data.collections[collection]; }
  find(collection, id) { return this.data.collections[collection].find((d) => d.id === id) || null; }
  insert(collection, doc) {
    const id = this.nextId(collection);
    const row = { ...doc, id, createdAt: new Date().toISOString() };
    this.data.collections[collection].push(row);
    this.save();
    return row;
  }
  update(collection, id, patch) {
    const row = this.find(collection, id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return row;
  }
  remove(collection, id) {
    const arr = this.data.collections[collection];
    const i = arr.findIndex((d) => d.id === id);
    if (i < 0) return false;
    arr.splice(i, 1);
    this.save();
    return true;
  }
  saveUpload(base64, mimeType, subdir) {
    const buf = Buffer.from(base64, "base64");
    if (buf.length === 0 || buf.length > 28_000_000) throw new Error("File không hợp lệ hoặc quá lớn (tối đa ~28 MB)");
    const ext = mimeType === "image/png" ? "png"
      : mimeType === "image/jpeg" ? "jpg"
      : mimeType === "audio/mpeg" ? "mp3"
      : mimeType === "audio/ogg" ? "ogg"
      : mimeType === "audio/mp4" ? "m4a" : "wav";
    const dir = path.join(this.uploadsDir, subdir);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
    fs.writeFileSync(path.join(dir, name), buf);
    return { fileName: name, url: `/uploads/${subdir}/${name}`, mimeType };
  }
}

function err(message) { const e = new Error(message); e.isBridgeError = true; return e; }
function ok(data) { return { data }; }
function str(v) { return typeof v === "string" ? v : ""; }
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

// ---- VieNeu-TTS (máy chủ cục bộ http://127.0.0.1:8000, API tương thích OpenAI) ----
async function vieneuStatus() {
  try {
    const res = await fetch(`${VIENEU_BASE}/v1/voices`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, running: false, voices: [], defaultVoice: "", error: `Máy chủ VieNeu-TTS trả mã ${res.status}. ${VIENEU_HINT}` };
    const body = await res.json().catch(() => ({}));
    const voices = Array.isArray(body.voices) ? body.voices.map((v) => (typeof v === "string" ? v : v.name || "")).filter(Boolean)
      : Array.isArray(body.data) ? body.data.map((v) => v.id || v.name || "").filter(Boolean) : [];
    return { ok: true, running: true, voices, defaultVoice: voices[0] || "", error: "" };
  } catch {
    return { ok: false, running: false, voices: [], defaultVoice: "", error: VIENEU_HINT };
  }
}

async function vieneuSynthesize(voice, text) {
  const res = await fetch(`${VIENEU_BASE}/v1/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "vieneu-v3-turbo", voice, input: text, response_format: "wav" }),
    signal: AbortSignal.timeout(170000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw err(`Máy chủ VieNeu-TTS trả mã ${res.status}: ${t.slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw err("Máy chủ VieNeu-TTS trả về file rỗng");
  return buf;
}

async function vieneuClone(name, audioBase64, mimeType, description) {
  const bytes = Buffer.from(audioBase64, "base64");
  if (bytes.length === 0 || bytes.length > 20_000_000) throw err("File âm thanh mẫu không hợp lệ (cần file 3–8 giây, tối đa 20 MB)");
  const form = new FormData();
  form.append("name", name);
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), "sample.wav");
  form.append("denoise", "true");
  if (description) form.append("description", description);
  const res = await fetch(`${VIENEU_BASE}/v1/voices`, { method: "POST", body: form, signal: AbortSignal.timeout(110000) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw err(`Máy chủ VieNeu-TTS trả mã ${res.status}: ${t.slice(0, 300)}`);
  }
  return name;
}

// ---- Đồng bộ web ↔ Windows bằng file sao lưu đầy đủ ------------------------
// GIỚI HẠN TRUNG THỰC: bản web MODOLIVIO không có API/máy chủ đám mây công khai
// để bản Windows gọi trực tiếp, nên KHÔNG có đồng bộ tự động qua mạng.
// Cơ chế thật trong bản này: xuất toàn bộ dữ liệu ra 1 file JSON
// (dự án, nhân vật, giọng, sản phẩm, đơn hàng, kho, tài chính, vận chuyển,
// khách hàng, khuyến mãi, nhân viên, sàn, affiliate, mạng xã hội, bài đăng,
// tài khoản MODOLIVIO + key kích hoạt), rồi nhập file đó ở bản còn lại.
// - Nhập theo kiểu GỘP: mục nào cùng id thì ghi đè bằng bản mới hơn (theo
//   updatedAt/createdAt), mục mới thì thêm vào; không xóa dữ liệu đích.
// - Tài khoản đi kèm passHash (không có mật khẩu thô) nên đăng nhập được ngay
//   bằng cùng email + mật khẩu ở bản còn lại.
// - File sao lưu KHÔNG mang theo ảnh/nhạc đã tải lên (nằm trong thư mục
//   uploads của từng máy) — ảnh cảnh/ảnh mặt/ảnh sản phẩm phải chép tay thư
//   mục uploads nếu cần, hoặc tải lại. Đây cũng là giới hạn của nút
//   "Xuất file dự án" trên bản web (chỉ mang kịch bản/caption/sản phẩm).
function exportBackup(store) {
  return {
    app: "MODOLIVIO",
    kind: "full-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: JSON.parse(JSON.stringify(store.data)),
  };
}

function importBackup(store, payload) {
  if (!payload || payload.app !== "MODOLIVIO" || payload.kind !== "full-backup" || !payload.data || !payload.data.collections) {
    throw err("File sao lưu không hợp lệ (không phải file sao lưu đầy đủ của MODOLIVIO).");
  }
  const incoming = payload.data;
  const counts = { updated: 0, added: 0 };
  for (const c of COLLECTIONS) {
    const rows = Array.isArray(incoming.collections[c]) ? incoming.collections[c] : [];
    const mine = store.all(c);
    for (const row of rows) {
      if (row.id == null) continue;
      const i = mine.findIndex((d) => d.id === row.id);
      if (i >= 0) {
        const oldTs = String(mine[i].updatedAt || mine[i].createdAt || "");
        const newTs = String(row.updatedAt || row.createdAt || "");
        if (newTs >= oldTs) { mine[i] = { ...mine[i], ...row }; counts.updated += 1; }
      } else {
        mine.push(row);
        counts.added += 1;
      }
    }
    // Giữ seq không trùng id đã nhập.
    const max = mine.reduce((m, d) => Math.max(m, d.id || 0), 0);
    if (!store.data.seq) store.data.seq = {};
    if ((store.data.seq[c] || 0) <= max) store.data.seq[c] = max + 1;
  }
  if (incoming.settings && typeof incoming.settings === "object") {
    store.data.settings = { ...store.data.settings, ...incoming.settings };
    if (incoming.settings.planPrices) store.data.settings.planPrices = incoming.settings.planPrices;
    if (incoming.settings.planFeatures) store.data.settings.planFeatures = incoming.settings.planFeatures;
  }
  store.save();
  return counts;
}

module.exports = { Store, DEFAULT_MIX, DEFAULT_VOICE, VOICE_PRESETS, VIENEU_HINT, AI_UNAVAILABLE, vieneuStatus, vieneuSynthesize, vieneuClone, err, ok, str, num, hashPassword, makeLicenseKey, DEFAULT_PLAN_PRICES, DEFAULT_PLAN_FEATURES, PLAN_FEATURE_KEYS, exportBackup, importBackup };
