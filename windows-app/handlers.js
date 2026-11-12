
// ---- Bộ điều phối actions (phần 2: handlers) ----
const B = require("./bridge.js");
const { Store, str, num } = B;

// Bảng thực thể: action list/create/update/delete -> collection + khóa trả về.
const ENTITIES = {
  jobs: { list: "listJobs", listKey: "jobs", del: "deleteJob" },
  products: { list: "listProducts", listKey: "products" },
  characters: { list: "listCharacters", listKey: "characters", create: "createCharacter", update: "updateCharacter", del: "deleteCharacter" },
  voices: { list: "listUserVoices", listKey: "voices", create: "createVoice", update: "updateVoice", del: "deleteVoice" },
  presets: { list: "listPresets", listKey: "presets", create: "createPreset", del: "deletePreset" },
  accounts: { list: "listAccounts", listKey: "accounts", create: "createAccount", update: "updateAccount", del: "deleteAccount" },
  series: { list: "listSeries", listKey: "series", create: "createSeries", update: "updateSeries", del: "deleteSeries" },
  music: { list: "listMusic", listKey: "tracks", del: "deleteMusic" },
  posts: { list: "listPosts", listKey: "posts", del: "deletePost" },
  backgrounds: { list: "listUserBackgrounds", listKey: "backgrounds", create: "createUserBackground", update: "updateUserBackground", del: "deleteUserBackground" },
  reverse: { list: "listReverse", listKey: "items", del: "deleteReverse" },
  feedback: { list: "listFeedback", listKey: "items" },
  shops: { list: "listShops", listKey: "shops", create: "createShop", update: "updateShop", del: "deleteShop" },
  finance: { list: "listFinance", listKey: "entries", create: "addFinanceEntry", del: "deleteFinanceEntry" },
  affiliateProducts: { list: "listAffiliateProducts", listKey: "products", create: "createAffiliateProduct", update: "updateAffiliateProduct", del: "deleteAffiliateProduct" },
  affiliateLinks: { list: "listAffiliateLinks", listKey: "links", create: "createAffiliateLink", update: "updateAffiliateLink", del: "deleteAffiliateLink" },
  sampleRequests: { list: "listSampleRequests", listKey: "requests", create: "createSampleRequest", update: "updateSampleRequest", del: "deleteSampleRequest" },
  inventory: { list: "listInventory", listKey: "items", create: "createInventoryItem", update: "updateInventoryItem", del: "deleteInventoryItem" },
  stockMovements: { list: "listStockMovements", listKey: "movements" },
  orders: { list: "listOrders", listKey: "orders", create: "createOrder", del: "deleteOrder" },
  carriers: { list: "listCarriers", listKey: "carriers", create: "createCarrier", del: "deleteCarrier" },
  shippers: { list: "listShippers", listKey: "shippers", create: "createShipper", del: "deleteShipper" },
  shipments: { list: "listShipments", listKey: "shipments", create: "createShipment", update: "updateShipment", del: "deleteShipment" },
  liveSessions: { list: "listLiveSessions", listKey: "sessions", create: "createLiveSession", update: "updateLiveSession", del: "deleteLiveSession" },
  customers: { list: "listCustomers", listKey: "customers", create: "createCustomer", update: "updateCustomer", del: "deleteCustomer" },
  promotions: { list: "listPromotions", listKey: "promotions", create: "createPromotion", del: "deletePromotion" },
  staff: { list: "listStaff", listKey: "members", create: "createStaff", del: "deleteStaff" },
  socialAccounts: { list: "listSocialAccounts", listKey: "accounts", create: "createSocialAccount", update: "updateSocialAccount", del: "deleteSocialAccount" },
  abVariants: { list: "listAbVariants", listKey: "variants", del: "deleteAbVariant" },
};

function dstr(v, fallback = "") { return typeof v === "string" && v ? v : fallback; }
function dateOf(doc) {
  const d = doc.orderDate || doc.entryDate || (typeof doc.createdAt === "string" ? doc.createdAt.slice(0, 10) : "");
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

// Chuẩn hóa doc về đúng hình dạng bản web trả về, để client không đọc phải undefined.
function normalizeJob(doc) {
  if (!doc) return null;
  const scenes = Array.isArray(doc.scenes) ? doc.scenes : [];
  const product = doc.product || {};
  return {
    id: num(doc.id), productId: num(doc.productId || (product && product.id) || 0),
    title: dstr(doc.title), status: dstr(doc.status, "done"), currentStep: dstr(doc.currentStep, "done"),
    stepAttempts: num(doc.stepAttempts), error: dstr(doc.error),
    caption: dstr(doc.caption), hashtags: Array.isArray(doc.hashtags) ? doc.hashtags : [],
    voiceJson: typeof doc.voiceJson === "string" ? doc.voiceJson : "",
    outputJson: typeof doc.outputJson === "string" ? doc.outputJson : "",
    settingsJson: typeof doc.settingsJson === "string" ? doc.settingsJson : "{}",
    createdAt: dstr(doc.createdAt, new Date().toISOString()),
    facePhotos: Array.isArray(doc.facePhotos) ? doc.facePhotos : [],
    product: {
      id: num(product.id || doc.productId), name: dstr(product.name), description: dstr(product.description),
      benefits: dstr(product.benefits || product.description), variants: Array.isArray(product.variants) ? product.variants : [],
      sourceUrl: dstr(product.sourceUrl), platform: dstr(product.platform), status: dstr(product.status),
      attentionReason: dstr(product.attentionReason), imageUrls: Array.isArray(product.imageUrls) ? product.imageUrls : [],
      images: Array.isArray(product.images) ? product.images : [],
    },
    scenes: scenes.map((s, i) => ({
      id: num(s.id || i + 1), idx: num(s.idx || i + 1), title: dstr(s.title), dialogue: dstr(s.dialogue),
      visualPrompt: dstr(s.visualPrompt), smile: !!s.smile, durationSec: num(s.durationSec, 10),
      motion: dstr(s.motion, "zoom_in"), imageUrl: dstr(s.imageUrl),
      faceScore: s.faceScore == null ? null : num(s.faceScore), faceNote: dstr(s.faceNote),
      faceAttempts: num(s.faceAttempts), transitionScore: s.transitionScore == null ? null : num(s.transitionScore),
      transitionNote: dstr(s.transitionNote), settingChange: !!s.settingChange, backgroundText: dstr(s.backgroundText),
      subtitleText: dstr(s.subtitleText), clipSpeed: num(s.clipSpeed, 1),
      audio: { musicTrack: dstr(s.audio && s.audio.musicTrack), musicVol: num(s.audio && s.audio.musicVol, 15), voiceVol: num(s.audio && s.audio.voiceVol, 100), effectsVol: num(s.audio && s.audio.effectsVol, 50) },
      reviewStatus: dstr(s.reviewStatus), reviewNote: dstr(s.reviewNote),
      history: Array.isArray(s.history) ? s.history : [],
    })),
  };
}

const NORMALIZERS = {
  jobs: (r) => normalizeJob(r),
  products: (r) => ({ id: num(r.id), name: dstr(r.name), description: dstr(r.description), benefits: dstr(r.benefits || r.description), variants: Array.isArray(r.variants) ? r.variants : [], sourceUrl: dstr(r.sourceUrl), platform: dstr(r.platform), status: dstr(r.status), attentionReason: dstr(r.attentionReason), imageUrls: Array.isArray(r.imageUrls) ? r.imageUrls : [], images: Array.isArray(r.images) ? r.images : [], jobId: num(r.jobId) }),
  characters: (r) => ({ ...r, id: num(r.id), name: dstr(r.name), ageGroup: dstr(r.ageGroup), gender: dstr(r.gender), style: dstr(r.style), outfit: dstr(r.outfit), voiceRef: dstr(r.voiceRef), facePhotos: r.facePhotos || {}, isDefault: !!r.isDefault }),
  voices: (r) => ({ ...r, id: num(r.id), name: dstr(r.name), ref: dstr(r.ref || r.voiceRef), region: dstr(r.region, "hanoi"), gender: dstr(r.gender, "nu"), speed: dstr(r.speed, "vua"), description: dstr(r.description), sampleLine: dstr(r.sampleLine), engine: dstr(r.engine, "device"), vieneuName: dstr(r.vieneuName) }),
  presets: (r) => ({ ...r, id: num(r.id), name: dstr(r.name) }),
  accounts: (r) => ({ ...r, id: num(r.id), name: dstr(r.name), label: dstr(r.label || r.name), status: dstr(r.status, "ready"), runsUsed: num(r.runsUsed), runsDay: num(r.runsDay), dailyLimit: num(r.dailyLimit), runsLimit: num(r.runsLimit), isActive: !!r.isActive, proxy: dstr(r.proxy), loginEmail: dstr(r.loginEmail), connectedAt: dstr(r.connectedAt) }),
  series: (r) => ({ ...r, id: num(r.id), title: dstr(r.title), genre: dstr(r.genre), status: dstr(r.status, "draft") }),
  music: (r) => ({ ...r, id: num(r.id), name: dstr(r.name), url: dstr(r.url), mimeType: dstr(r.mimeType), durationSec: num(r.durationSec), source: dstr(r.source, "upload"), licenseNote: dstr(r.licenseNote, "own") }),
  posts: (r) => ({ id: num(r.id), jobId: num(r.jobId), jobTitle: dstr(r.jobTitle), platform: dstr(r.platform), status: dstr(r.status, "draft"), scheduledAt: dstr(r.scheduledAt), postedUrl: dstr(r.postedUrl), views: num(r.views), likes: num(r.likes), comments: num(r.comments), cartClicks: num(r.cartClicks), accountId: num(r.accountId), attempts: num(r.attempts), lastError: dstr(r.lastError) }),
  backgrounds: (r) => ({ ...r, id: num(r.id), name: dstr(r.name), description: dstr(r.description), imageUrl: dstr(r.imageUrl) }),
  reverse: (r) => ({ ...r, id: num(r.id), url: dstr(r.url), productName: dstr(r.productName), status: dstr(r.status) }),
  feedback: (r) => ({ ...r, id: num(r.id), message: dstr(r.message) }),
  shops: (r) => ({ ...r, id: num(r.id), name: dstr(r.name), platform: dstr(r.platform) }),
  finance: (r) => ({ ...r, id: num(r.id), kind: dstr(r.kind), platform: dstr(r.platform), productName: dstr(r.productName), jobId: num(r.jobId), amount: num(r.amount), entryDate: dstr(r.entryDate), note: dstr(r.note) }),
  affiliateProducts: (r) => ({ ...r, id: num(r.id), name: dstr(r.name), soldOrders: num(r.soldOrders), revenue: num(r.revenue), commissionDue: num(r.commissionDue) }),
  affiliateLinks: (r) => ({ ...r, id: num(r.id), url: dstr(r.url), productName: dstr(r.productName) }),
  sampleRequests: (r) => ({ ...r, id: num(r.id), productName: dstr(r.productName), status: dstr(r.status) }),
  inventory: (r) => ({ ...r, id: num(r.id), name: dstr(r.name), stock: num(r.stock), costPrice: num(r.costPrice), price: num(r.price) }),
  stockMovements: (r) => ({ ...r, id: num(r.id), itemId: num(r.itemId), delta: num(r.delta), stock: num(r.stock), note: dstr(r.note) }),
  orders: (r) => {
    let items = [];
    if (Array.isArray(r.items)) items = r.items;
    else if (typeof r.itemsJson === "string") { try { items = JSON.parse(r.itemsJson); } catch { items = []; } }
    return {
      id: num(r.id), platform: dstr(r.platform, "shopee"), externalCode: dstr(r.externalCode),
      customerName: dstr(r.customerName || r.customer), customerPhone: dstr(r.customerPhone || r.phone),
      address: dstr(r.address), items: items.map((it) => ({ name: dstr(it.name), variant: dstr(it.variant), qty: num(it.qty, 1), price: num(it.price) })),
      totalAmount: num(r.totalAmount ?? r.total), status: dstr(r.status, "cho-xac-nhan"),
      jobId: r.jobId == null ? null : num(r.jobId), orderDate: dateOf(r),
    };
  },
  carriers: (r, store) => {
    const mine = store.all("shipments").filter((s) => s.carrier === r.name);
    const delivered = mine.filter((s) => s.status === "da-giao").length;
    const failed = mine.filter((s) => s.status === "giao-loi").length;
    const returned = mine.filter((s) => s.status === "tra-hang").length;
    return {
      id: num(r.id), name: dstr(r.name), avgDays: num(r.avgDays, 2), baseFee: num(r.baseFee), perKgFee: num(r.perKgFee),
      note: dstr(r.note), total: mine.length, delivered, failed, returned,
      avgFee: mine.length ? Math.round(mine.reduce((s, x) => s + num(x.fee), 0) / mine.length) : 0,
      failPct: mine.length ? Math.round((failed / mine.length) * 1000) / 10 : 0,
    };
  },
  shippers: (r, store) => {
    const mine = store.all("shipments").filter((s) => s.shipper === r.name || s.shipperId === r.id);
    return {
      id: num(r.id), name: dstr(r.name), phone: dstr(r.phone), area: dstr(r.area), carrier: dstr(r.carrier),
      note: dstr(r.note), delivering: mine.filter((s) => s.status === "dang-giao").length,
      delivered: mine.filter((s) => s.status === "da-giao").length, failed: mine.filter((s) => s.status === "giao-loi").length,
    };
  },
  shipments: (r) => ({ ...r, id: num(r.id), code: dstr(r.code), carrier: dstr(r.carrier), fee: num(r.fee), status: dstr(r.status) }),
  liveSessions: (r) => ({ ...r, id: num(r.id), title: dstr(r.title), status: dstr(r.status) }),
  customers: (r) => ({ id: num(r.id), name: dstr(r.name), phone: dstr(r.phone), tier: dstr(r.tier, "thường"), note: dstr(r.note), lastCare: dstr(r.lastCare), orderCount: num(r.orderCount), totalSpent: num(r.totalSpent), autoTier: dstr(r.autoTier || r.tier, "thường") }),
  promotions: (r) => ({ ...r, id: num(r.id), name: dstr(r.name), code: dstr(r.code), status: dstr(r.status) }),
  staff: (r) => ({ ...r, id: num(r.id), name: dstr(r.name), sales: num(r.sales) }),
  socialAccounts: (r) => ({
    id: num(r.id), platform: dstr(r.platform), name: dstr(r.name), handle: dstr(r.handle),
    status: dstr(r.status, "chua-ket-noi"), followers: num(r.followers), note: dstr(r.note),
    connectedAt: dstr(r.connectedAt),
    postCount: num(r.postCount), views: num(r.views), cartClicks: num(r.cartClicks),
    dailyPostLimit: num(r.dailyPostLimit, 3), minGapHours: num(r.minGapHours, 1), health: dstr(r.health, "tot"),
    postsToday: num(r.postsToday), madeToday: num(r.madeToday),
    effectiveLimit: num(r.effectiveLimit, 3), remainingToday: num(r.remainingToday, 3),
  }),
  abVariants: (r) => ({ ...r, id: num(r.id), name: dstr(r.name), metrics: r.metrics || { views: 0, likes: 0, clicks: 0 } }),
  shops: (r) => ({ id: num(r.id), platform: dstr(r.platform), name: dstr(r.name), url: dstr(r.url), status: dstr(r.status, "chua-ket-noi"), productCount: num(r.productCount), note: dstr(r.note), connectedAt: dstr(r.connectedAt) }),
};

function buildGenericHandlers(store) {
  const h = {};
  for (const [collection, cfg] of Object.entries(ENTITIES)) {
    if (cfg.list) {
      h[cfg.list] = () => {
        const norm = NORMALIZERS[collection];
        const rows = store.all(collection).map((r) => (norm ? norm(r, store) : { ...r }));
        if (cfg.list === "listPosts") {
          const totals = {
            views: rows.reduce((s, p) => s + num(p.views), 0),
            likes: rows.reduce((s, p) => s + num(p.likes), 0),
            comments: rows.reduce((s, p) => s + num(p.comments), 0),
            cartClicks: rows.reduce((s, p) => s + num(p.cartClicks), 0),
            postCount: rows.length,
          };
          const best = [...rows].sort((a, b) => num(b.views) - num(a.views))[0];
          return { posts: rows, totals, bestJobId: best ? num(best.jobId) : 0, bestJobTitle: best ? str(best.jobTitle) : "" };
        }
        if (cfg.list === "listOrders") {
          const delivered = rows.filter((o) => o.status === "da-giao");
          const pending = rows.filter((o) => o.status !== "da-giao" && o.status !== "da-huy").length;
          return {
            orders: rows,
            totals: { count: rows.length, deliveredRevenue: delivered.reduce((s, o) => s + num(o.totalAmount), 0), pending },
          };
        }
        return { [cfg.listKey]: rows };
      };
    }
    if (cfg.create) {
      h[cfg.create] = (a) => {
        const { id, ...rest } = a || {};
        const row = store.insert(collection, rest);
        return { id: row.id };
      };
    }
    if (cfg.update) {
      h[cfg.update] = (a) => {
        const row = store.update(collection, a.id, a);
        if (!row) throw B.err("Không tìm thấy mục cần sửa");
        return { ok: true };
      };
    }
    if (cfg.del) {
      h[cfg.del] = (a) => {
        store.remove(collection, a.id);
        return { ok: true };
      };
    }
  }
  return h;
}

const BANNED_PHRASES = ["chữa khỏi", "trị dứt điểm", "cam kết khỏi", "100% khỏi", "khỏi hoàn toàn", "đảm bảo khỏi bệnh", "thần dược", "thuốc tiên"];

function findJob(store, jobId) {
  return store.find("jobs", jobId) || null;
}

function buildHandlers(store) {
  const h = buildGenericHandlers(store);
  const S = () => store.data.settings;

  // ---------- Cài đặt ----------
  h.getSettings = () => {
    const s = S();
    return {
      defaultVoiceRef: s.defaultVoiceRef || B.DEFAULT_VOICE.ref,
      volumes: s.volumes || B.DEFAULT_MIX,
      advancedTools: s.advancedTools || { musicgen: false, f5tts: false, xtts: false, insightface: false },
      logoUrl: s.logoUrl || "",
      defaultVoice: { ...B.DEFAULT_VOICE, ref: s.defaultVoiceRef || B.DEFAULT_VOICE.ref },
    };
  };
  h.setDefaultVoice = (a) => { S().defaultVoiceRef = str(a.voiceRef); store.save(); return { ok: true }; };
  h.setVolumes = (a) => { S().volumes = { ...B.DEFAULT_MIX, ...(a || {}), muted: { ...B.DEFAULT_MIX.muted, ...((a || {}).muted || {}) } }; store.save(); return { ok: true }; };
  h.setAdvancedTools = (a) => { S().advancedTools = { ...(S().advancedTools || {}), ...(a || {}) }; store.save(); return { ok: true }; };
  h.getModules = () => ({ modules: { ...(S().modules || {}) } });
  h.setModules = (a) => { S().modules = { ...(a.modules || {}) }; store.save(); return { ok: true }; };
  h.uploadLogo = (a) => {
    const f = store.saveUpload(a.base64, a.mimeType || "image/png", "logo");
    S().logoUrl = f.url; store.save();
    return { url: f.url };
  };

  // ---------- Jobs / pipeline ----------
  h.getJob = (a) => ({ job: normalizeJob(findJob(store, a.jobId)) });
  h.quickCreate = () => { throw B.err(B.AI_UNAVAILABLE); };
  h.runPipelineStep = (a) => ({
    status: "needs_attention", jobId: a.jobId, currentStep: "read",
    message: "Bản Windows chưa chạy được bước pipeline AI.",
    note: B.AI_UNAVAILABLE, waiting: true,
  });
  h.retryJob = () => ({ ok: true });
  h.cancelJob = (a) => { const j = findJob(store, a.jobId); if (j) { j.status = "cancelled"; store.save(); } return { ok: true }; };
  h.duplicateJob = (a) => {
    const j = findJob(store, a.jobId);
    if (!j) throw B.err("Không tìm thấy dự án");
    const { id: _oldId, ...rest } = j;
    const copy = store.insert("jobs", { ...rest, title: `${j.title || "Dự án"} (bản sao)`, status: "draft" });
    return { jobId: copy.id };
  };
  h.saveJobAsPreset = (a) => {
    const j = findJob(store, a.jobId);
    const row = store.insert("presets", { name: (j && j.title) || "Mẫu dự án", jobId: a.jobId });
    return { id: row.id };
  };
  h.updateProduct = (a) => {
    const p = store.find("products", a.id) || store.find("products", a.productId);
    if (p) store.update("products", p.id, a);
    return { ok: true };
  };
  h.uploadProductImage = (a) => {
    const f = store.saveUpload(a.imageBase64, a.mimeType || "image/jpeg", "products");
    const p = store.find("products", a.productId);
    if (p) { const imgs = Array.isArray(p.images) ? [...p.images, f.url] : [f.url]; store.update("products", p.id, { images: imgs }); }
    return { ok: true, count: 1 };
  };
  h.importProject = (a) => {
    let parsed;
    try { parsed = JSON.parse(a.data); } catch { throw B.err("File dự án không phải JSON hợp lệ"); }
    const title = str(parsed.title).trim();
    if (!title) throw B.err("File dự án thiếu tiêu đề dự án");
    const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
    const job = store.insert("jobs", {
      title, caption: parsed.caption || "", hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      product: parsed.product || {}, status: "done",
      scenes: scenes.map((s, i) => ({ idx: s.idx ?? i + 1, title: s.title || "", dialogue: s.dialogue || "", visualPrompt: s.visualPrompt || "", durationSec: s.durationSec || 10, motion: s.motion || "", smile: !!s.smile })),
    });
    if (parsed.product && parsed.product.name) {
      store.insert("products", { name: parsed.product.name, description: parsed.product.description || "", jobId: job.id });
    }
    return { jobId: job.id, sceneCount: scenes.length };
  };

  // ---------- Cảnh (làm việc trên job đã import) ----------
  const sceneOf = (a) => {
    const j = findJob(store, a.jobId);
    if (!j || !Array.isArray(j.scenes)) return null;
    return j.scenes.find((s) => s.idx === a.sceneIdx) || null;
  };
  h.updateScene = (a) => { const s = sceneOf(a); if (s) { Object.assign(s, a); store.save(); } return { ok: true }; };
  h.setSceneReview = (a) => { const s = sceneOf(a); if (s) { s.review = a.review || a.status; store.save(); } return { ok: true }; };
  h.setJobReview = () => ({ ok: true });
  h.setJobCharacterVoice = (a) => { const j = findJob(store, a.jobId); if (j) { j.characterVoiceRef = a.voiceRef; store.save(); } return { ok: true }; };
  h.setSceneTransition = (a) => { const s = sceneOf(a); if (s) { s.transition = a.transition || a.type; store.save(); } return { ok: true }; };
  h.setSceneBackground = (a) => { const s = sceneOf(a); if (s) { s.background = a.backgroundId || a.background; store.save(); } return { ok: true }; };
  h.addScene = (a) => {
    const j = findJob(store, a.jobId);
    if (!j) throw B.err("Không tìm thấy dự án");
    if (!Array.isArray(j.scenes)) j.scenes = [];
    const idx = j.scenes.length + 1;
    j.scenes.push({ idx, title: "", dialogue: "", visualPrompt: "", durationSec: 10, motion: "", smile: false });
    store.save();
    return { id: idx, idx };
  };
  h.deleteScene = (a) => { const j = findJob(store, a.jobId); if (j && Array.isArray(j.scenes)) { j.scenes = j.scenes.filter((s) => s.idx !== a.sceneIdx); store.save(); } return { ok: true }; };
  h.moveScene = (a) => {
    const j = findJob(store, a.jobId);
    if (j && Array.isArray(j.scenes)) {
      const i = j.scenes.findIndex((s) => s.idx === a.sceneIdx);
      const to = (a.toIdx ?? a.newIdx ?? i + 1) - 1;
      if (i >= 0 && to >= 0 && to < j.scenes.length) { const [s] = j.scenes.splice(i, 1); j.scenes.splice(to, 0, s); j.scenes.forEach((sc, k) => { sc.idx = k + 1; }); store.save(); }
    }
    return { ok: true };
  };
  h.restoreSceneVersion = () => ({ ok: true });
  h.updateJobCaption = (a) => { const j = findJob(store, a.jobId); if (j) { j.caption = a.caption; if (a.hashtags) j.hashtags = a.hashtags; store.save(); } return { ok: true }; };
  h.uploadSceneImage = (a) => {
    const f = store.saveUpload(a.imageBase64 || a.base64, a.mimeType || "image/jpeg", "scenes");
    const s = sceneOf(a); if (s) { s.imageUrl = f.url; store.save(); }
    return { ok: true };
  };
  h.updateVoiceLine = (a) => { const s = sceneOf(a); if (s) { s.voiceLine = a.text || a.line; store.save(); } return { ok: true }; };
  h.synthesizeSceneVoice = (a) => {
    const s = sceneOf(a);
    const lines = s && Array.isArray(s.voiceLines) ? s.voiceLines : [];
    return { ok: true, synthesized: lines.length, lines };
  };

  // ---------- Kiểm tra chất lượng / khuôn mặt / chuyển cảnh (cục bộ, không AI) ----------
  h.checkExportQuality = (a) => {
    const j = findJob(store, a.jobId);
    const checks = [];
    if (!j) {
      checks.push({ key: "job", label: "Dự án tồn tại", status: "fail", detail: "Không tìm thấy dự án" });
    } else {
      const nj = normalizeJob(j);
      checks.push({ key: "scenes", label: "Có cảnh video", status: nj.scenes.length > 0 ? "pass" : "fail", detail: `Đang có ${nj.scenes.length} cảnh` });
      checks.push({ key: "caption", label: "Có caption", status: nj.caption.trim() ? "pass" : "fail", detail: nj.caption ? "Đã có caption" : "Chưa có caption" });
      checks.push({ key: "face", label: "Điểm giống khuôn mặt ≥ 95%", status: "warn", detail: "Bản Windows chưa có dịch vụ chấm điểm khuôn mặt — kiểm tra trên bản web" });
    }
    const failCount = checks.filter((c) => c.status === "fail").length;
    const warnCount = checks.filter((c) => c.status === "warn").length;
    return { readyToExport: failCount === 0, failCount, warnCount, checks };
  };
  h.checkSceneFace = () => ({ score: null, flagged: false, note: "Bản Windows chưa có dịch vụ chấm điểm khuôn mặt — kiểm tra trên bản web." });
  h.checkTransition = () => ({ score: null, note: "Bản Windows chưa chấm điểm chuyển cảnh tự động — xem trước đoạn chuyển cảnh để kiểm tra bằng mắt." });
  h.regenerateSceneImage = () => { throw B.err(B.AI_UNAVAILABLE); };

  // ---------- VieNeu-TTS (chạy thật nếu máy chủ cục bộ đang chạy) ----------
  h.getVieneuStatus = async () => B.vieneuStatus();
  h.previewVieneuVoice = async (a) => {
    const st = await B.vieneuStatus();
    if (!st.running) return { audioUrl: "", error: st.error };
    try {
      const buf = await B.vieneuSynthesize(a.voiceName, a.text);
      const f = store.saveUpload(buf.toString("base64"), "audio/wav", "voices");
      return { audioUrl: f.url, error: "" };
    } catch (e) { return { audioUrl: "", error: e.message }; }
  };
  h.cloneVieneuVoice = async (a) => {
    const st = await B.vieneuStatus();
    if (!st.running) throw B.err(st.error);
    const voiceName = await B.vieneuClone(a.name, a.audioBase64, a.mimeType || "audio/wav", a.description || "");
    const row = store.insert("voices", {
      name: a.name, ref: `vieneu:${voiceName}`, region: a.region, gender: a.gender, speed: a.speed || "vua",
      description: a.description || "", sampleLine: a.sampleLine || "", engine: "vieneu", vieneuName: voiceName,
    });
    return { engineRef: `vieneu:${voiceName}`, id: row.id };
  };

  // ---------- Nhân vật / giọng ----------
  h.duplicateCharacter = (a) => {
    const c = store.find("characters", a.id);
    if (!c) throw B.err("Không tìm thấy nhân vật");
    const copy = store.insert("characters", { ...c, name: `${c.name || "Nhân vật"} (bản sao)` });
    return { id: copy.id };
  };
  h.setDefaultCharacter = (a) => { S().defaultCharacterId = a.id; store.save(); return { ok: true }; };
  h.uploadFacePhoto = (a) => {
    const f = store.saveUpload(a.imageBase64, a.mimeType || "image/jpeg", "faces");
    const c = a.characterId ? store.find("characters", a.characterId) : null;
    if (c) {
      const photos = { ...(c.facePhotos || {}) };
      photos[a.slot || "front"] = { blobKey: f.url, description: "" };
      store.update("characters", c.id, { facePhotos: photos });
    }
    return { blobKey: f.url, description: "" };
  };
  h.lockFaceFromScene = () => ({ description: "Đã khóa khuôn mặt từ ảnh cảnh (bản Windows lưu ảnh tham chiếu, chưa chấm điểm AI)." });
  h.importCharacterProfile = (a) => {
    const text = str(a.text);
    const pick = (re) => { const m = text.match(re); return m ? m[1].trim() : ""; };
    return {
      name: pick(/tên[:：]\s*(.+)/i) || "", gender: /nữ|nu\b/i.test(text) ? "nu" : "nam",
      ageGroup: pick(/tuổi[:：]\s*(.+)/i) || "", appearance: "", outfit: "",
      personality: "", occupation: "", hobbies: "", speechStyle: "", lifestyle: "",
      relationships: "", voiceName: "", voiceRef: "",
    };
  };
  h.suggestVoicesForCharacter = (a) => {
    const d = str(a.description).toLowerCase();
    const region = d.includes("sài gòn") || d.includes("saigon") || d.includes("miền nam") ? "saigon"
      : d.includes("miền tây") || d.includes("mientay") ? "mientay" : "hanoi";
    const gender = d.includes("nam") && !d.includes("nữ") ? "nam" : "nu";
    const picks = B_VOICE_PICK(region, gender);
    return { suggestions: picks.map((p) => ({ ref: p.ref, name: p.name, reason: `Hợp mô tả: ${p.name} (${region === "hanoi" ? "Hà Nội" : region === "saigon" ? "Sài Gòn" : "Miền Tây"}, ${gender === "nu" ? "nữ" : "nam"})` })) };
  };
  h.inferCharacterProfile = () => { throw B.err(B.AI_UNAVAILABLE); };
  h.generateCharacter = () => { throw B.err(B.AI_UNAVAILABLE); };

  // ---------- Hỗ trợ soạn (mẫu cục bộ, ghi rõ không phải AI) ----------
  h.assistCaption = (a) => {
    const j = findJob(store, a.jobId);
    if (!j) throw B.err("Không tìm thấy dự án");
    const name = (j.product && j.product.name) || j.title || "sản phẩm này";
    const benefit = (j.product && j.product.description) || "";
    const caption = benefit
      ? `Dùng ${name} mà thấy ${benefit} thì đúng là chân ái rồi đấy ạ! Mình dùng thử và thấy ưng lắm nhé, bấm giỏ hàng phía dưới để chốt về dùng thử ạ!`
      : `Mọi người ơi, hôm nay mình review ${name} này nhé, xem là mê luôn đấy ạ! Bấm giỏ hàng phía dưới để chốt về dùng thử ạ!`;
    return {
      caption,
      hashtags: ["#reviewsanpham", "#skincare", "#chamsocda", "#duongda", "#xuhuong"],
      warnings: ["Soạn theo mẫu cục bộ trên bản Windows — chưa dùng Muse AI, hãy đọc lại và sửa trước khi đăng."],
    };
  };
  h.assistDialogue = (a) => {
    const s = sceneOf(a);
    const original = (s && (s.dialogue || s.voiceLine || "")) || "";
    return {
      rewritten: original,
      alternatives: [],
      warnings: ["Bản Windows chưa có AI viết lại thoại — giữ nguyên câu gốc, hãy sửa tay theo gợi ý của bạn."],
    };
  };
  h.assistSceneMusic = (a) => {
    const tracks = store.all("music");
    const s = S();
    return {
      track: tracks.length ? (tracks[0].name || "") : "",
      musicVol: (s.volumes && s.volumes.music) ?? 15,
      voiceVol: (s.volumes && s.volumes.voice) ?? 100,
      effectsVol: (s.volumes && s.volumes.effects) ?? 50,
      reason: tracks.length ? "Chọn bài đầu tiên trong thư viện nhạc của bạn (bản Windows chọn theo mẫu cục bộ)." : "Thư viện nhạc đang trống — hãy tải nhạc lên trước.",
    };
  };
  h.assistSubtitles = () => { throw B.err(B.AI_UNAVAILABLE); };

  // ---------- Bài đăng ----------
  h.upsertPost = (a) => {
    if (a.id) {
      const r = store.find("posts", a.id);
      if (r) { store.update("posts", r.id, a); return { id: r.id }; }
    }
    const row = store.insert("posts", { ...a, metrics: { views: 0, likes: 0, comments: 0, clicks: 0 } });
    return { id: row.id };
  };
  h.updatePostMetrics = (a) => { const r = store.find("posts", a.id); if (r) store.update("posts", r.id, { metrics: a.metrics }); return { ok: true }; };

  // ---------- Tài khoản / chi phí ----------
  h.setActiveAccount = (a) => { S().activeAccountId = a.id; store.save(); return { ok: true }; };
  h.updateAccountRuns = (a) => { const r = store.find("accounts", a.id); if (r) store.update("accounts", r.id, { runsUsed: a.runsUsed ?? r.runsUsed, runsDay: a.runsDay ?? r.runsDay }); return { ok: true }; };
  h.addAccountRuns = (a) => {
    const r = store.find("accounts", a.id);
    const runsDay = (r ? num(r.runsDay) : 0) + num(a.runs, 1);
    const runsUsed = (r ? num(r.runsUsed) : 0) + num(a.runs, 1);
    if (r) store.update("accounts", r.id, { runsDay, runsUsed });
    return { runsDay, runsUsed };
  };
  h.getCostSummary = () => {
    const accs = store.all("accounts");
    const today = accs.reduce((s, x) => s + num(x.runsDay), 0);
    const total = accs.reduce((s, x) => s + num(x.runsUsed), 0);
    const cfg = S().costConfig || { runsPerVideo: 8, pricePerRun: 0 };
    return {
      today, week: today, month: total, total,
      todayCost: today * num(cfg.pricePerRun), weekCost: today * num(cfg.pricePerRun),
      monthCost: total * num(cfg.pricePerRun), totalCost: total * num(cfg.pricePerRun),
      runsPerVideo: num(cfg.runsPerVideo, 8), pricePerRun: num(cfg.pricePerRun),
    };
  };
  h.setCostConfig = (a) => { S().costConfig = { runsPerVideo: num(a.runsPerVideo, 8), pricePerRun: num(a.pricePerRun) }; store.save(); return { ok: true }; };

  // ---------- Gói / nhóm / phản hồi / A-B ----------
  h.getPlan = () => {
    const p = S().plan || {};
    const thisMonth = store.all("jobs").filter((j) => { const d = new Date(j.createdAt || 0); const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth(); }).length;
    return { plan: p.plan || "free", planName: p.planName || "Miễn phí", monthlyLimit: num(p.monthlyLimit, 3), videosThisMonth: thisMonth, since: p.since || "", payments: p.payments || [] };
  };
  h.setPlan = (a) => { S().plan = { ...(S().plan || {}), plan: a.plan, planName: a.planName, monthlyLimit: a.monthlyLimit }; store.save(); return { ok: true }; };
  h.addPaymentRecord = (a) => { const p = S().plan || {}; p.payments = [...(p.payments || []), { ...a, at: new Date().toISOString() }]; S().plan = p; store.save(); return { ok: true }; };
  h.getTeam = () => ({ members: [...(S().team || [])] });
  h.setTeam = (a) => { S().team = Array.isArray(a.members) ? a.members : []; store.save(); return { ok: true }; };
  h.submitFeedback = (a) => { const row = store.insert("feedback", a || {}); return { id: row.id }; };
  h.createAbVariants = (a) => {
    const variants = Array.isArray(a.variants) ? a.variants : [{ name: "A" }, { name: "B" }];
    const rows = variants.map((v) => store.insert("abVariants", { ...v, metrics: { views: 0, likes: 0, clicks: 0 } }));
    return { created: rows.length };
  };
  h.updateAbVariantMetrics = (a) => { const r = store.find("abVariants", a.id); if (r) store.update("abVariants", r.id, { metrics: a.metrics }); return { ok: true }; };

  // ---------- Xu hướng / an toàn / gợi ý ----------
  h.suggestTrends = () => ({ angles: [], hooks: [], productIdeas: [], note: "Gợi ý xu hướng cần dữ liệu mạng — chưa có trên bản Windows." });
  h.checkContentSafety = (a) => {
    const j = findJob(store, a.jobId);
    const text = [j && j.caption, j && j.title, j && (j.product || {}).name, j && (j.product || {}).description].filter(Boolean).join(" ");
    const platform = a.platform || "";
    const findings = BANNED_PHRASES.filter((p) => text.toLowerCase().includes(p)).map((p) => ({ level: "warn", platform, text: `Cụm từ "${p}" dễ vi phạm chính sách nền tảng — nên bỏ.` }));
    return { ok: findings.length === 0, findings };
  };
  h.suggestAffiliateProducts = () => ({ ideas: [], note: "Gợi ý sản phẩm affiliate cần dữ liệu sàn — chưa có trên bản Windows." });

  // ---------- Nhạc ----------
  h.uploadMusic = (a) => {
    const f = store.saveUpload(a.audioBase64, a.mimeType || "audio/mpeg", "music");
    const row = store.insert("music", { name: a.name, mimeType: a.mimeType, url: f.url, licenseNote: dstr(a.licenseNote, "own") });
    return { id: row.id };
  };
  h.createCafeVideo = () => { throw B.err(B.AI_UNAVAILABLE); };

  // ---------- Dịch ngược / seri ----------
  h.createReverseFromLink = (a) => {
    const row = store.insert("reverse", { url: a.url, productName: a.productName || "", productDescription: a.productDescription || "", characterId: a.characterId ?? null, voiceRef: a.voiceRef || "", status: "needs_ai" });
    return { id: row.id };
  };
  h.saveReverseAnalysis = (a) => { const r = store.find("reverse", a.id); if (r) store.update("reverse", r.id, { analysis: a.analysis }); return { ok: true }; };
  h.updateReverse = (a) => { const r = store.find("reverse", a.id); if (r) store.update("reverse", r.id, a); return { ok: true }; };
  h.analyzeReverseFrames = () => { throw B.err(B.AI_UNAVAILABLE); };
  h.rewriteReverse = () => { throw B.err(B.AI_UNAVAILABLE); };
  h.buildReverseVideo = () => { throw B.err(B.AI_UNAVAILABLE); };
  h.createSeriesFromReverse = (a) => {
    const r = store.find("reverse", a.reverseId || a.id);
    const row = store.insert("series", { title: (r && r.productName) || "Seri mới", fromReverseId: r ? r.id : null });
    return { id: row.id };
  };
  h.generateOutline = () => { throw B.err(B.AI_UNAVAILABLE); };
  h.buildEpisode = () => { throw B.err(B.AI_UNAVAILABLE); };
  h.buildAllEpisodes = () => { throw B.err(B.AI_UNAVAILABLE); };
  h.setEpisodeRelease = () => ({ ok: true });

  // ---------- Bối cảnh ----------
  h.uploadBackgroundImage = (a) => {
    const f = store.saveUpload(a.base64, a.mimeType || "image/jpeg", "backgrounds");
    return { blobKey: f.url, description: "", url: f.url };
  };
  h.suggestBackgrounds = () => ({ suggestions: [], varyNote: "Gợi ý bối cảnh bằng AI chưa có trên bản Windows — hãy chọn trong 50 bối cảnh có sẵn.", varyPerScene: false });

  // ---------- Tài chính / báo cáo ----------
  h.getFinanceSummary = () => {
    const entries = store.all("finance").map((e) => NORMALIZERS.finance(e));
    const byKind = {};
    let revenue = 0, costs = 0;
    for (const e of entries) {
      byKind[e.kind || "khác"] = (byKind[e.kind || "khác"] || 0) + num(e.amount);
      if (e.kind === "doanh-thu") revenue += num(e.amount); else costs += num(e.amount);
    }
    const orders = store.all("orders").map((o) => NORMALIZERS.orders(o));
    const vidMap = new Map();
    for (const o of orders) {
      if (o.jobId == null) continue;
      const v = vidMap.get(o.jobId) || { revenue: 0 };
      v.revenue += num(o.totalAmount); vidMap.set(o.jobId, v);
    }
    const bestVid = [...vidMap.entries()].sort((a, b) => b[1].revenue - a[1].revenue)[0];
    const jobs = store.all("jobs");
    const topVideo = bestVid
      ? { jobId: bestVid[0], title: (jobs.find((j) => j.id === bestVid[0]) || {}).title || `Video #${bestVid[0]}`, revenue: bestVid[1].revenue }
      : { jobId: 0, title: "", revenue: 0 };
    const inv = store.all("inventory");
    const costOf = new Map(inv.map((x) => [x.name, num(x.costPrice)]));
    const prodProfit = new Map();
    for (const o of orders) {
      for (const it of o.items || []) {
        prodProfit.set(it.name, (prodProfit.get(it.name) || 0) + num(it.qty) * (num(it.price) - (costOf.get(it.name) || 0)));
      }
    }
    const bestProd = [...prodProfit.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      periods: [{ label: "Tất cả", revenue, costs, profit: revenue - costs, byKind }],
      topVideo, topProduct: bestProd ? { name: bestProd[0], profit: bestProd[1] } : { name: "", profit: 0 },
      totalEntries: entries.length,
    };
  };
  h.getSalesReport = (a) => {
    const period = a.period || "thang";
    const days = period === "ngay" ? 1 : period === "tuan" ? 7 : period === "thang" ? 30 : period === "quy" ? 90 : 365;
    const periodLabel = period === "ngay" ? "Hôm nay" : period === "tuan" ? "7 ngày qua" : period === "thang" ? "30 ngày qua" : period === "quy" ? "Quý này (90 ngày)" : "Năm nay (365 ngày)";
    const now = Date.now();
    const curStart = new Date(now - days * 86400000).toISOString().slice(0, 10);
    const prevStart = new Date(now - 2 * days * 86400000).toISOString().slice(0, 10);
    // Kỳ hiện tại kết thúc ở NGÀY MAI (bao cả đơn hôm nay). Bản web v5 dùng
    // to = hôm nay nên vô tình loại đơn hôm nay khỏi kỳ hiện tại; bản Windows
    // sửa lại cho đúng ("doanh thu hôm nay" phải gồm đơn hôm nay).
    const endDay = new Date(now + 86400000).toISOString().slice(0, 10);
    const orders = store.all("orders").map((o) => NORMALIZERS.orders(o));
    const fin = store.all("finance").map((e) => NORMALIZERS.finance(e));
    const inWindow = (rows, from, to) => rows.filter((r) => { const d = dateOf(r); return d >= from && d < to; });
    const sumOrders = (from, to) => {
      const rows = inWindow(orders, from, to).filter((r) => r.status === "da-giao");
      return { revenue: rows.reduce((s, r) => s + num(r.totalAmount), 0), orders: rows.length, rows };
    };
    const sumFin = (from, to) => {
      const rows = inWindow(fin, from, to);
      return {
        rev: rows.filter((f) => f.kind === "doanh-thu").reduce((s, f) => s + num(f.amount), 0),
        cost: rows.filter((f) => f.kind !== "doanh-thu").reduce((s, f) => s + num(f.amount), 0),
      };
    };
    const cur = sumOrders(curStart, endDay), prev = sumOrders(prevStart, curStart);
    const finCur = sumFin(curStart, endDay), finPrev = sumFin(prevStart, curStart);
    const current = { revenue: cur.revenue + finCur.rev, costs: finCur.cost, profit: cur.revenue + finCur.rev - finCur.cost, orders: cur.orders };
    const previous = { revenue: prev.revenue + finPrev.rev, costs: finPrev.cost, profit: prev.revenue + finPrev.rev - finPrev.cost, orders: prev.orders };
    const revenueChangePct = previous.revenue > 0 ? Math.round(((current.revenue - previous.revenue) / previous.revenue) * 1000) / 10 : current.revenue > 0 ? 100 : 0;
    const platMap = new Map();
    for (const r of cur.rows) { const e = platMap.get(r.platform) || { revenue: 0, orders: 0 }; e.revenue += num(r.totalAmount); e.orders += 1; platMap.set(r.platform, e); }
    const byPlatform = [...platMap.entries()].map(([platform, v]) => ({ platform, ...v })).sort((x, y) => y.revenue - x.revenue);
    const inv = store.all("inventory");
    const costOf = new Map(inv.map((x) => [x.name, num(x.costPrice)]));
    const prodMap = new Map();
    for (const r of cur.rows) {
      for (const it of r.items || []) {
        const e = prodMap.get(it.name) || { revenue: 0, estProfit: 0, qty: 0 };
        e.revenue += num(it.qty) * num(it.price);
        e.estProfit += num(it.qty) * (num(it.price) - (costOf.get(it.name) || 0));
        e.qty += num(it.qty); prodMap.set(it.name, e);
      }
    }
    const topProducts = [...prodMap.entries()].map(([name, v]) => ({ name, ...v })).sort((x, y) => y.estProfit - x.estProfit).slice(0, 5);
    const vidMap = new Map();
    for (const r of cur.rows) {
      if (r.jobId == null) continue;
      const e = vidMap.get(r.jobId) || { orders: 0, revenue: 0 };
      e.orders += 1; e.revenue += num(r.totalAmount); vidMap.set(r.jobId, e);
    }
    const bestVid = [...vidMap.entries()].sort((x, y) => y[1].orders - x[1].orders)[0];
    const jobs = store.all("jobs");
    const topVideo = bestVid
      ? { jobId: bestVid[0], title: (jobs.find((j) => j.id === bestVid[0]) || {}).title || `Video #${bestVid[0]}`, orders: bestVid[1].orders, revenue: bestVid[1].revenue }
      : null;
    return { periodLabel, current, previous, revenueChangePct, byPlatform, topProducts, topVideo };
  };
  h.getAffiliateSummary = () => {
    const links = store.all("affiliateLinks");
    const clicks = links.reduce((s, l) => s + num(l.clicks), 0);
    const orders = store.all("orders");
    const bestVid = (() => {
      const m = new Map();
      for (const o of orders) { if (o.jobId == null) continue; const e = m.get(o.jobId) || 0; m.set(o.jobId, e + 1); }
      const b = [...m.entries()].sort((x, y) => y[1] - x[1])[0];
      if (!b) return { jobId: 0, title: "", orders: 0 };
      const job = store.all("jobs").find((j) => j.id === b[0]);
      return { jobId: b[0], title: job ? job.title : "", orders: b[1] };
    })();
    const prods = store.all("affiliateProducts");
    const bestProd = [...prods].sort((a, b) => num(b.soldOrders) - num(a.soldOrders))[0];
    return {
      totalClicks: clicks, totalOrders: orders.length,
      conversionPct: clicks > 0 ? Math.round((orders.length / clicks) * 1000) / 10 : 0,
      commissionPending: 0, commissionApproved: 0, commissionWithdrawn: 0,
      bestVideo: bestVid,
      bestProduct: bestProd ? { id: bestProd.id, name: bestProd.name || "", orders: num(bestProd.soldOrders) } : { id: 0, name: "", orders: 0 },
    };
  };
  h.recordStockMovement = (a) => {
    const item = store.find("inventory", a.itemId || a.id);
    let stock = item ? num(item.stock) : 0;
    stock += num(a.delta || a.change || 0);
    if (item) store.update("inventory", item.id, { stock });
    store.insert("stockMovements", { itemId: item ? item.id : null, delta: num(a.delta || a.change || 0), note: a.note || "", stock });
    return { ok: true, stock };
  };

  // ---------- Vận chuyển ----------
  h.quoteShipping = (a) => {
    const weight = Math.max(0.1, num(a.weightKg, 0.5));
    const quotes = store.all("carriers").map((c) => ({
      carrier: c.name, fee: Math.round(num(c.baseFee) + num(c.perKgFee) * weight), days: num(c.avgDays, 2),
      note: "Phí tham khảo theo bảng phí đã lưu trong app",
    }));
    return { quotes };
  };
  h.getShippingSettings = () => ({ ...(S().shippingSettings || { defaultSize: "20x15x10", defaultWeightKg: 0.5, pickupAddress: "", warehouseAddress: "" }) });
  h.setShippingSettings = (a) => { S().shippingSettings = { ...(S().shippingSettings || {}), ...(a || {}) }; store.save(); return { ok: true }; };
  h.getShippingReport = () => {
    const ships = store.all("shipments").map((s) => NORMALIZERS.shipments(s));
    const delivered = ships.filter((x) => x.status === "da-giao").length;
    const failed = ships.filter((x) => x.status === "giao-loi").length;
    const returned = ships.filter((x) => x.status === "tra-hang").length;
    const totalFee = ships.reduce((s, x) => s + num(x.fee), 0);
    const carriers = store.all("carriers").map((c) => NORMALIZERS.carriers(c, store));
    const byName = (fn) => {
      const sorted = [...carriers].sort(fn);
      return sorted.length ? sorted[0].name : "";
    };
    return {
      totals: { total: ships.length, delivered, failed, returned, totalFee },
      fastest: byName((a, b) => a.avgDays - b.avgDays),
      cheapest: byName((a, b) => a.baseFee - b.baseFee),
      leastFailed: byName((a, b) => a.failPct - b.failPct),
    };
  };
  h.updateShipment = (a) => { const r = store.find("shipments", a.id); if (r) store.update("shipments", r.id, a); return { ok: true }; };
  h.updateOrderStatus = (a) => { const r = store.find("orders", a.id); if (r) store.update("orders", r.id, { status: a.status }); return { ok: true }; };
  h.deleteOrder = (a) => { store.remove("orders", a.id); return { ok: true }; };

  // ---------- Khách / khuyến mãi / nhân viên / live / shop ----------
  h.updateCustomer = (a) => { const r = store.find("customers", a.id); if (r) store.update("customers", r.id, a); return { ok: true }; };
  h.importCustomersFromOrders = () => {
    const orders = store.all("orders");
    let added = 0;
    for (const o of orders) {
      const name = o.customerName || o.customer || "";
      if (!name) continue;
      if (!store.all("customers").some((c) => c.name === name)) {
        store.insert("customers", { name, phone: o.customerPhone || "", totalSpent: num(o.total), orderCount: 1, tier: "thường" });
        added += 1;
      }
    }
    return { added };
  };
  h.updatePromotionStatus = (a) => { const r = store.find("promotions", a.id); if (r) store.update("promotions", r.id, { status: a.status }); return { ok: true }; };
  h.updateStaffStats = (a) => { const r = store.find("staff", a.id); if (r) store.update("staff", r.id, a); return { ok: true }; };
  h.updateLiveSession = (a) => { const r = store.find("liveSessions", a.id); if (r) store.update("liveSessions", r.id, a); return { ok: true }; };
  h.updateShop = (a) => { const r = store.find("shops", a.id); if (r) store.update("shops", r.id, a); return { ok: true }; };
  h.updateSocialAccount = (a) => { const r = store.find("socialAccounts", a.id); if (r) store.update("socialAccounts", r.id, a); return { ok: true }; };
  h.planPostingSchedule = (a) => {
    const slots = Array.isArray(a.slots) ? a.slots : Array.isArray(a.dates) ? a.dates : [1];
    const accounts = Array.isArray(a.accountIds) ? a.accountIds : [1];
    const assigned = slots.length * accounts.length;
    store.insert("schedules", { slots, accountIds: accounts, assigned, at: new Date().toISOString() });
    return { assigned };
  };

  // ---------- Tài khoản MODOLIVIO / Admin / key kích hoạt (v1.1 — khớp bản web) ----------
  // Tài khoản lưu cục bộ trên máy này; băm mật khẩu giống hệt bản web
  // (SHA-256 của "modolivio:" + mật khẩu) nên cùng email + mật khẩu đăng nhập
  // được ở cả hai bản, và file sao lưu đầy đủ mang được tài khoản sang bản kia.
  const toUserShape = (u) => ({
    id: num(u.id), name: dstr(u.name), email: dstr(u.email), role: dstr(u.role, "user"),
    status: dstr(u.status, "active"), plan: dstr(u.plan, "free"), createdAt: dstr(u.createdAt, ""),
  });
  const logUsage = (userId, userEmail, action) => {
    try { store.insert("usageLog", { userId: num(userId), userEmail: dstr(userEmail), action: dstr(action) }); } catch { /* không chặn thao tác chính */ }
  };
  const requireAdmin = (adminUserId) => {
    const admin = store.find("appUsers", num(adminUserId));
    if (!admin || admin.role !== "admin" || admin.status !== "active") {
      throw B.err("Chỉ tài khoản Quản trị viên mới dùng được mục này.");
    }
    return admin;
  };
  const planPrices = () => ({ ...B.DEFAULT_PLAN_PRICES, ...((S().planPrices) || {}) });
  const planFeatures = () => {
    const base = JSON.parse(JSON.stringify(B.DEFAULT_PLAN_FEATURES));
    const mine = S().planFeatures || {};
    for (const k of Object.keys(base)) if (Array.isArray(mine[k])) base[k] = mine[k];
    return base;
  };

  h.registerUser = (a) => {
    const name = str(a.name).trim();
    const email = str(a.email).trim().toLowerCase();
    const password = str(a.password);
    if (!name) throw B.err("Chưa nhập tên hiển thị.");
    if (email.length < 3) throw B.err("Email chưa đúng.");
    if (password.length < 4) throw B.err("Mật khẩu cần ít nhất 4 ký tự.");
    if (store.all("appUsers").some((u) => u.email === email)) {
      throw B.err("Email này đã đăng ký — hãy đăng nhập hoặc dùng Quên mật khẩu.");
    }
    const role = store.all("appUsers").length === 0 ? "admin" : "user";
    const user = store.insert("appUsers", { name, email, passHash: B.hashPassword(password), role, status: "active", plan: "free" });
    logUsage(user.id, email, role === "admin" ? "Đăng ký tài khoản (Quản trị viên đầu tiên)" : "Đăng ký tài khoản");
    return { user: toUserShape(user) };
  };
  h.loginUser = (a) => {
    const email = str(a.email).trim().toLowerCase();
    const user = store.all("appUsers").find((u) => u.email === email);
    if (!user) throw B.err("Email này chưa đăng ký — hãy bấm Đăng ký tài khoản mới.");
    if (user.status === "locked") throw B.err("Tài khoản đang bị khóa — liên hệ Quản trị viên để mở lại.");
    if (user.passHash !== B.hashPassword(str(a.password))) throw B.err("Mật khẩu chưa đúng — thử lại hoặc dùng Quên mật khẩu.");
    logUsage(user.id, email, "Đăng nhập");
    return { user: toUserShape(user) };
  };
  h.resetUserPassword = (a) => {
    const email = str(a.email).trim().toLowerCase();
    const user = store.all("appUsers").find((u) => u.email === email);
    if (!user) throw B.err("Email này chưa đăng ký trên hệ thống.");
    if (user.status === "locked") throw B.err("Tài khoản đang bị khóa — liên hệ Quản trị viên.");
    if (str(a.newPassword).length < 4) throw B.err("Mật khẩu mới cần ít nhất 4 ký tự.");
    store.update("appUsers", user.id, { passHash: B.hashPassword(str(a.newPassword)) });
    logUsage(user.id, email, "Đặt lại mật khẩu (quên mật khẩu)");
    return { ok: true };
  };
  h.updateUserProfile = (a) => {
    const user = store.find("appUsers", num(a.userId));
    if (!user) throw B.err("Không tìm thấy tài khoản.");
    const row = store.update("appUsers", user.id, { name: str(a.name).trim() });
    return { user: toUserShape(row) };
  };
  h.changeUserPassword = (a) => {
    const user = store.find("appUsers", num(a.userId));
    if (!user) throw B.err("Không tìm thấy tài khoản.");
    if (user.passHash !== B.hashPassword(str(a.currentPassword))) throw B.err("Mật khẩu hiện tại chưa đúng.");
    if (str(a.newPassword).length < 4) throw B.err("Mật khẩu mới cần ít nhất 4 ký tự.");
    store.update("appUsers", user.id, { passHash: B.hashPassword(str(a.newPassword)) });
    logUsage(user.id, user.email, "Đổi mật khẩu");
    return { ok: true };
  };
  h.listMyPayments = (a) => ({
    payments: store.all("userPayments")
      .filter((p) => num(p.userId) === num(a.userId))
      .sort((x, y) => num(y.id) - num(x.id)).slice(0, 50)
      .map((p) => ({ id: num(p.id), plan: dstr(p.plan), amount: num(p.amount), note: dstr(p.note), createdAt: dstr(p.createdAt, "") })),
  });
  h.listNotices = () => ({
    notices: [...store.all("appNotices")].sort((x, y) => num(y.id) - num(x.id)).slice(0, 30)
      .map((n) => ({ id: num(n.id), title: dstr(n.title), body: dstr(n.body), createdAt: dstr(n.createdAt, "") })),
  });
  h.adminOverview = (a) => {
    requireAdmin(a.adminUserId);
    const users = [...store.all("appUsers")].sort((x, y) => num(y.id) - num(x.id));
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const newUsers7d = users.filter((u) => u.createdAt && new Date(u.createdAt).getTime() >= weekAgo).length;
    const payments = [...store.all("userPayments")].sort((x, y) => num(y.id) - num(x.id)).slice(0, 100);
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    const revenueMap = new Map();
    for (const p of payments) {
      const cur = revenueMap.get(p.plan) || { total: 0, count: 0 };
      cur.total += num(p.amount); cur.count += 1; revenueMap.set(p.plan, cur);
    }
    return {
      users: users.map(toUserShape), totalUsers: users.length, newUsers7d,
      revenueByPlan: [...revenueMap.entries()].map(([plan, v]) => ({ plan, total: v.total, count: v.count })),
      totalRevenue: payments.reduce((s, p) => s + num(p.amount), 0),
      prices: planPrices(), features: planFeatures(),
      promos: store.all("promoCodes").map((p) => ({ id: num(p.id), code: dstr(p.code), discountText: dstr(p.discountText), active: p.active !== 0 })),
      payments: payments.map((p) => ({ id: num(p.id), userId: num(p.userId), userEmail: emailById.get(p.userId) || "", plan: dstr(p.plan), amount: num(p.amount), note: dstr(p.note), createdAt: dstr(p.createdAt, "") })),
      notices: [...store.all("appNotices")].sort((x, y) => num(y.id) - num(x.id)).slice(0, 30)
        .map((n) => ({ id: num(n.id), title: dstr(n.title), body: dstr(n.body), createdAt: dstr(n.createdAt, "") })),
      usageLog: [...store.all("usageLog")].sort((x, y) => num(y.id) - num(x.id)).slice(0, 60)
        .map((l) => ({ id: num(l.id), userEmail: dstr(l.userEmail), action: dstr(l.action), createdAt: dstr(l.createdAt, "") })),
    };
  };
  h.adminSetUserStatus = (a) => {
    const admin = requireAdmin(a.adminUserId);
    if (num(a.userId) === admin.id && a.status === "locked") throw B.err("Không thể tự khóa tài khoản Quản trị viên của chính mình.");
    const user = store.find("appUsers", num(a.userId));
    if (!user) throw B.err("Không tìm thấy người dùng.");
    store.update("appUsers", user.id, { status: a.status === "locked" ? "locked" : "active" });
    logUsage(user.id, user.email, a.status === "locked" ? "Bị Quản trị viên khóa tài khoản" : "Được Quản trị viên mở lại tài khoản");
    return { ok: true };
  };
  h.adminSetUserRole = (a) => {
    const admin = requireAdmin(a.adminUserId);
    if (num(a.userId) === admin.id && a.role !== "admin") throw B.err("Không thể tự hạ quyền Quản trị viên của chính mình.");
    const user = store.find("appUsers", num(a.userId));
    if (!user) throw B.err("Không tìm thấy người dùng.");
    store.update("appUsers", user.id, { role: a.role === "admin" ? "admin" : "user" });
    return { ok: true };
  };
  h.adminSetUserPlan = (a) => {
    requireAdmin(a.adminUserId);
    const user = store.find("appUsers", num(a.userId));
    if (!user) throw B.err("Không tìm thấy người dùng.");
    store.update("appUsers", user.id, { plan: a.plan });
    const amount = (planPrices()[a.plan] || 0);
    if (amount > 0) store.insert("userPayments", { userId: user.id, plan: a.plan, amount, note: str(a.note) || "Admin đổi gói cho người dùng" });
    logUsage(user.id, user.email, `Đổi gói dùng sang ${a.plan}${amount > 0 ? ` (ghi thanh toán ${amount.toLocaleString("vi-VN")} đ)` : ""}`);
    return { ok: true };
  };
  h.adminSetPlanPrices = (a) => {
    requireAdmin(a.adminUserId);
    S().planPrices = { free: num(a.prices.free), month: num(a.prices.month), year: num(a.prices.year) };
    store.save();
    return { ok: true };
  };
  h.adminSetPlanFeatures = (a) => {
    requireAdmin(a.adminUserId);
    const clean = {};
    for (const plan of ["free", "month", "year"]) {
      clean[plan] = (Array.isArray((a.features || {})[plan]) ? a.features[plan] : []).filter((k) => B.PLAN_FEATURE_KEYS.includes(k));
    }
    S().planFeatures = clean;
    store.save();
    return { ok: true };
  };
  h.adminCreatePromo = (a) => {
    requireAdmin(a.adminUserId);
    store.insert("promoCodes", { code: str(a.code).trim().toUpperCase(), discountText: str(a.discountText).trim(), active: 1 });
    return { ok: true };
  };
  h.adminSetPromoActive = (a) => {
    requireAdmin(a.adminUserId);
    const p = store.find("promoCodes", num(a.promoId));
    if (p) store.update("promoCodes", p.id, { active: a.active ? 1 : 0 });
    return { ok: true };
  };
  h.adminCreateNotice = (a) => {
    requireAdmin(a.adminUserId);
    store.insert("appNotices", { title: str(a.title).trim(), body: str(a.body).trim() });
    return { ok: true };
  };
  h.adminDeleteNotice = (a) => {
    requireAdmin(a.adminUserId);
    store.remove("appNotices", num(a.noticeId));
    return { ok: true };
  };
  h.adminCreateLicenseKeys = (a) => {
    requireAdmin(a.adminUserId);
    const count = Math.min(50, Math.max(1, num(a.count, 1)));
    const keys = [];
    for (let i = 0; i < count; i++) {
      let key = B.makeLicenseKey();
      if (store.all("licenseKeys").some((k) => k.key === key)) key = B.makeLicenseKey();
      keys.push(key);
      store.insert("licenseKeys", { key, plan: a.plan, status: "unused", machineCode: "", activatedEmail: "", note: str(a.note), activatedAt: "", expiresAt: "" });
    }
    return { keys };
  };
  h.adminListLicenseKeys = (a) => {
    requireAdmin(a.adminUserId);
    const rows = [...store.all("licenseKeys")].sort((x, y) => num(y.id) - num(x.id)).slice(0, 300);
    return {
      keys: rows.map((k) => ({ id: num(k.id), key: dstr(k.key), plan: dstr(k.plan), status: dstr(k.status), machineCode: dstr(k.machineCode), activatedEmail: dstr(k.activatedEmail), note: dstr(k.note), activatedAt: dstr(k.activatedAt), expiresAt: dstr(k.expiresAt), createdAt: dstr(k.createdAt, "") })),
      unused: rows.filter((k) => k.status === "unused").length,
      used: rows.filter((k) => k.status === "used").length,
      locked: rows.filter((k) => k.status === "locked").length,
    };
  };
  h.adminSetLicenseKeyLocked = (a) => {
    requireAdmin(a.adminUserId);
    const row = store.find("licenseKeys", num(a.keyId));
    if (!row) throw B.err("Không tìm thấy key.");
    store.update("licenseKeys", row.id, { status: a.locked ? "locked" : (row.machineCode ? "used" : "unused") });
    return { ok: true };
  };
  h.activateLicense = (a) => {
    const keyText = str(a.key).trim().toUpperCase();
    const row = store.all("licenseKeys").find((k) => k.key === keyText);
    if (!row) throw B.err("Key không tồn tại — kiểm tra lại key kích hoạt.");
    if (row.status === "locked") throw B.err("Key này đã bị khóa — liên hệ nơi bán để được hỗ trợ.");
    const today = new Date().toISOString().slice(0, 10);
    if (row.status === "used") {
      if (row.machineCode !== a.machineCode) throw B.err("Key này đã được kích hoạt trên một máy khác — mỗi key chỉ dùng cho một máy.");
      if (row.expiresAt && row.expiresAt < today) throw B.err(`Key đã hết hạn ngày ${row.expiresAt} — hãy gia hạn để tiếp tục dùng.`);
      return { plan: row.plan, expiresAt: row.expiresAt, machineCode: row.machineCode };
    }
    let expiresAt = "";
    if (row.plan !== "lifetime") {
      const d = new Date();
      if (row.plan === "year") d.setFullYear(d.getFullYear() + 1); else d.setMonth(d.getMonth() + 1);
      expiresAt = d.toISOString().slice(0, 10);
    }
    store.update("licenseKeys", row.id, { status: "used", machineCode: a.machineCode, activatedEmail: str(a.email).trim(), activatedAt: today, expiresAt });
    logUsage(0, str(a.email).trim(), `Kích hoạt key gói ${row.plan} cho máy ${a.machineCode}`);
    return { plan: row.plan, expiresAt, machineCode: a.machineCode };
  };
  h.checkLicense = (a) => {
    const row = store.all("licenseKeys").find((k) => k.machineCode === a.machineCode);
    if (!row) return { state: "none", plan: "", expiresAt: "" };
    if (row.status === "locked") return { state: "locked", plan: row.plan, expiresAt: row.expiresAt };
    const today = new Date().toISOString().slice(0, 10);
    if (row.expiresAt && row.expiresAt < today) return { state: "expired", plan: row.plan, expiresAt: row.expiresAt };
    return { state: "active", plan: row.plan, expiresAt: row.expiresAt };
  };

  // ---------- Đọc link sản phẩm: lưu thông tin thật (bản Windows tải ảnh về) ----------
  h.saveProductInfo = async (a) => {
    const p = store.find("products", num(a.productId));
    if (!p) throw B.err("Không tìm thấy sản phẩm.");
    if (a.status === "attention") {
      store.update("products", p.id, { status: "attention", attentionReason: str(a.attentionReason) || "Không đọc được trang sản phẩm. Cần người dùng xử lý." });
      return { ok: true };
    }
    const urls = [];
    const imageUrls = Array.isArray(a.imageUrls) ? a.imageUrls.slice(0, 10) : [];
    for (let i = 0; i < imageUrls.length; i++) {
      try {
        const res = await fetch(imageUrls[i], { headers: { "user-agent": "Mozilla/5.0 (compatible; MODOLIVIO-Windows/1.1)" }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) continue;
        const ct = res.headers.get("content-type") || "";
        if (!ct.startsWith("image/")) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > 10_000_000) continue;
        const f = store.saveUpload(buf.toString("base64"), ct.includes("png") ? "image/png" : "image/jpeg", "products");
        urls.push(f.url);
      } catch { /* ảnh nào tải hỏng thì bỏ qua */ }
    }
    store.update("products", p.id, {
      name: str(a.name).trim(), description: str(a.description).trim(), benefits: str(a.benefits).trim(),
      variants: Array.isArray(a.variants) ? a.variants : [], priceText: str(a.priceText).trim(),
      imageUrls: urls, images: urls, status: "ready", attentionReason: "",
    });
    if (str(a.name).trim()) {
      // Job có thể liên kết sản phẩm qua productId, hoặc qua jobId lưu trên sản phẩm
      // (trường hợp job import từ file dự án).
      const job = store.all("jobs").find((j) => num(j.productId) === p.id || num(p.jobId) === j.id);
      if (job) store.update("jobs", job.id, { title: str(a.name).trim() });
    }
    return { ok: true };
  };

  // ---------- Sàn: kết nối / ngắt kết nối (khớp bản web v16) ----------
  // Ghi nhận kết nối tài khoản sàn: người dùng đã đăng nhập trên trang chính
  // thức của sàn rồi xác nhận trong app. Bản dùng thử chưa có API sàn nên đây
  // là gắn tài khoản vào app để quản lý, chưa tự lấy đơn/sản phẩm/doanh thu.
  h.connectShop = (a) => {
    const today = new Date().toISOString().slice(0, 10);
    if (a.id) {
      const r = store.find("shops", num(a.id));
      if (!r) throw B.err("Không tìm thấy gian hàng");
      store.update("shops", r.id, { name: dstr(a.name, r.name), url: dstr(a.url, r.url || ""), status: "da-ket-noi", connectedAt: today });
      return { id: r.id };
    }
    const row = store.insert("shops", { platform: dstr(a.platform), name: dstr(a.name), url: dstr(a.url), status: "da-ket-noi", connectedAt: today });
    return { id: row.id };
  };
  h.disconnectShop = (a) => {
    const r = store.find("shops", num(a.id));
    if (!r) throw B.err("Không tìm thấy gian hàng");
    store.update("shops", r.id, { status: "chua-ket-noi", connectedAt: "" });
    return { ok: true };
  };

  // ---------- Tài khoản Muse AI: ghi nhận đăng nhập / ngắt kết nối ----------
  h.setAccountConnection = (a) => {
    const today = new Date().toISOString().slice(0, 10);
    const r = store.find("accounts", num(a.id));
    if (!r) throw B.err("Không tìm thấy tài khoản Muse");
    if (a.connected) {
      store.update("accounts", r.id, { status: "ready", loginEmail: dstr(a.loginEmail), connectedAt: today });
    } else {
      store.update("accounts", r.id, { status: "login_needed", connectedAt: "" });
      // Tự chuyển tài khoản đang dùng sang tài khoản sẵn sàng còn lượt.
      const rows = store.all("accounts").slice().sort((x, y) => num(x.id) - num(y.id));
      const current = rows.find((x) => x.id === r.id);
      if (current && current.isActive) {
        const next = rows.find((x) => x.id !== r.id && x.status === "ready" && (num(x.runsLimit) === 0 || num(x.runsUsed) < num(x.runsLimit)));
        if (next) {
          store.update("accounts", r.id, { isActive: false });
          store.update("accounts", next.id, { isActive: true });
        }
      }
    }
    return { ok: true };
  };

  // ---------- Chatbot (khớp bản web v16) ----------
  const CHATBOT_DEFAULT_AI = [
    { key: "muse", label: "Muse AI", hasAccount: true, status: "san-sang" },
    { key: "chatgpt", label: "ChatGPT", hasAccount: false, status: "chua-co-tai-khoan" },
    { key: "claude", label: "Claude", hasAccount: false, status: "chua-co-tai-khoan" },
    { key: "gemini", label: "Gemini", hasAccount: false, status: "chua-co-tai-khoan" },
  ];
  const CHATBOT_DEFAULTS = {
    enabled: true, workStart: "08:00", workEnd: "22:00",
    greeting: "Dạ shop chào anh/chị ạ! Anh/chị cần tư vấn sản phẩm nào, cứ nhắn cho shop nhé ạ.",
    outsideMsg: "Dạ shop cảm ơn anh/chị đã nhắn tin ạ. Hiện đang ngoài giờ làm việc của shop (shop làm việc 8h–22h), shop sẽ trả lời anh/chị ngay khi vào giờ làm việc ạ. Anh/chị cứ để lại câu hỏi và số điện thoại, shop liên hệ lại sớm nhất ạ!",
    tone: "than-thien", returnPolicy: "", shippingPolicy: "",
  };
  const loadChatbotSettings = () => {
    const row = store.find("chatbotSettings", 1) || store.all("chatbotSettings")[0];
    if (!row) return { ...CHATBOT_DEFAULTS, aiProviders: CHATBOT_DEFAULT_AI.map((x) => ({ ...x })) };
    let ai = CHATBOT_DEFAULT_AI.map((x) => ({ ...x }));
    try { const parsed = JSON.parse(row.aiJson || "[]"); if (Array.isArray(parsed) && parsed.length) ai = parsed; } catch { /* giữ mặc định */ }
    return {
      enabled: row.enabled !== 0, workStart: dstr(row.workStart, "08:00"), workEnd: dstr(row.workEnd, "22:00"),
      greeting: dstr(row.greeting), outsideMsg: dstr(row.outsideMsg), tone: dstr(row.tone, "than-thien"),
      returnPolicy: dstr(row.returnPolicy), shippingPolicy: dstr(row.shippingPolicy), aiProviders: ai,
    };
  };
  const pickChatbotProvider = (providers) => {
    const skipped = [];
    for (const p of providers) {
      if (p.hasAccount && p.status === "san-sang") return { label: p.label, skipped };
      skipped.push(`${p.label} (${p.status === "het-tin-dung" ? "hết tín dụng" : "chưa có tài khoản"})`);
    }
    return { label: "Muse AI (miễn phí trong app)", skipped };
  };
  const vietnamNowHHMM = () => {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    } catch { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
  };
  const inWorkHours = (now, start, end) => {
    if (start === end) return true;
    if (start < end) return now >= start && now < end;
    return now >= start || now < end;
  };
  const CHATBOT_ANGRY_WORDS = ["lừa đảo", "lua dao", "báo công an", "bao cong an", "phốt", "phân nàn", "khiếu nại", "khieu nai", "đòi hoàn tiền", "hoàn tiền ngay", "quá thất vọng", "rất tức", "bực mình", "làm ăn kiểu gì", "treo đầu dê", "hàng giả", "hang gia"];
  const parseMsgs = (conv) => { try { const m = JSON.parse(conv.messagesJson || "[]"); return Array.isArray(m) ? m : []; } catch { return []; } };
  const saveConvMsgs = (conv, messages) => store.update("chatbotConversations", conv.id, { messagesJson: JSON.stringify(messages) });

  h.getChatbotSettings = () => {
    const s = loadChatbotSettings();
    const pick = pickChatbotProvider(s.aiProviders);
    const now = vietnamNowHHMM();
    return { ...s, activeProvider: pick.label, skippedProviders: pick.skipped, nowHHMM: now, inHours: inWorkHours(now, s.workStart, s.workEnd) };
  };
  h.saveChatbotSettings = (a) => {
    const values = {
      id: 1, enabled: a.enabled ? 1 : 0, workStart: dstr(a.workStart, "08:00"), workEnd: dstr(a.workEnd, "22:00"),
      greeting: dstr(a.greeting), outsideMsg: dstr(a.outsideMsg), tone: dstr(a.tone, "than-thien"),
      returnPolicy: dstr(a.returnPolicy), shippingPolicy: dstr(a.shippingPolicy),
      aiJson: JSON.stringify(Array.isArray(a.aiProviders) ? a.aiProviders : CHATBOT_DEFAULT_AI),
    };
    const row = store.find("chatbotSettings", 1) || store.all("chatbotSettings")[0];
    if (row) store.update("chatbotSettings", row.id, values); else store.insert("chatbotSettings", values);
    return { ok: true };
  };
  h.listChatbotKnowledge = () => ({
    items: store.all("chatbotKnowledge").slice().sort((a, b) => num(b.id) - num(a.id)).map((r) => ({
      id: num(r.id), question: dstr(r.question), keywords: dstr(r.keywords), answer: dstr(r.answer),
      category: dstr(r.category, "khac"), active: r.active !== 0,
    })),
  });
  h.createChatbotKnowledge = (a) => {
    const row = store.insert("chatbotKnowledge", { question: dstr(a.question), keywords: dstr(a.keywords), answer: dstr(a.answer), category: dstr(a.category, "khac"), active: 1 });
    return { id: row.id };
  };
  h.updateChatbotKnowledge = (a) => {
    const r = store.find("chatbotKnowledge", num(a.id));
    if (!r) throw B.err("Không tìm thấy câu trả lời đã dạy");
    store.update("chatbotKnowledge", r.id, { question: dstr(a.question), keywords: dstr(a.keywords), answer: dstr(a.answer), category: dstr(a.category, "khac"), active: a.active ? 1 : 0 });
    return { ok: true };
  };
  h.deleteChatbotKnowledge = (a) => { store.remove("chatbotKnowledge", num(a.id)); return { ok: true }; };
  h.listChatbotConversations = (a) => {
    const limit = Math.min(Math.max(num(a && a.limit, 100), 1), 200);
    const rows = store.all("chatbotConversations").slice().sort((x, y) => String(y.updatedAt || y.createdAt || "").localeCompare(String(x.updatedAt || x.createdAt || ""))).slice(0, limit);
    return {
      conversations: rows.map((r) => ({
        id: num(r.id), platform: dstr(r.platform, "facebook"), customerName: dstr(r.customerName), customerPhone: dstr(r.customerPhone),
        status: dstr(r.status, "bot"), escalateReason: dstr(r.escalateReason), orderId: num(r.orderId),
        messages: parseMsgs(r), updatedAt: dstr(r.updatedAt || r.createdAt, ""),
      })),
      needsHumanCount: rows.filter((r) => r.status === "needs_human").length,
    };
  };
  h.deleteChatbotConversation = (a) => { store.remove("chatbotConversations", num(a.id)); return { ok: true }; };
  h.chatbotHumanReply = (a) => {
    const conv = store.find("chatbotConversations", num(a.conversationId));
    if (!conv) throw B.err("Không tìm thấy hội thoại.");
    const messages = parseMsgs(conv);
    messages.push({ role: "human", text: dstr(a.text), at: new Date().toISOString() });
    store.update("chatbotConversations", conv.id, { messagesJson: JSON.stringify(messages), status: dstr(a.status, "bot"), escalateReason: a.status === "needs_human" ? dstr(conv.escalateReason) : "" });
    return { ok: true };
  };
  h.chatbotSetConversationStatus = (a) => {
    const conv = store.find("chatbotConversations", num(a.conversationId));
    if (!conv) throw B.err("Không tìm thấy hội thoại.");
    store.update("chatbotConversations", conv.id, { status: dstr(a.status), escalateReason: a.status === "needs_human" ? dstr(a.reason) : "" });
    return { ok: true };
  };
  h.chatbotCreateOrder = (a) => {
    const conv = store.find("chatbotConversations", num(a.conversationId));
    if (!conv) throw B.err("Không tìm thấy hội thoại.");
    const inv = store.all("inventory");
    const matched = inv.find((i) => String(i.name || "").trim().toLowerCase() === dstr(a.productName).trim().toLowerCase());
    const price = matched ? num(matched.price ?? matched.salePrice) : 0;
    const qty = Math.max(num(a.qty, 1), 1);
    const total = price * qty;
    const now = new Date().toISOString();
    const platformMap = { tiktok: "tiktokshop" };
    const order = store.insert("orders", {
      platform: platformMap[conv.platform] || conv.platform || "facebook", externalCode: "",
      customerName: dstr(a.customerName) || dstr(conv.customerName), customerPhone: dstr(a.phone) || dstr(conv.customerPhone),
      address: dstr(a.address), items: [{ name: dstr(a.productName), variant: "", qty, price }],
      itemsJson: JSON.stringify([{ name: dstr(a.productName), variant: "", qty, price }]),
      totalAmount: total, status: "cho-xac-nhan", jobId: null, orderDate: now.slice(0, 10),
    });
    store.update("orders", order.id, { externalCode: `CB-${order.id}` });
    const messages = parseMsgs(conv);
    messages.push({ role: "system", text: `Đã tạo đơn CB-${order.id} trong app: ${dstr(a.productName)} ×${qty}${total > 0 ? ` — tổng ${total.toLocaleString("vi-VN")}đ` : ""}. Đơn đang ở trạng thái chờ xác nhận trong mục Bán hàng.`, at: now });
    store.update("chatbotConversations", conv.id, { messagesJson: JSON.stringify(messages), orderId: order.id, customerName: dstr(a.customerName) || dstr(conv.customerName), customerPhone: dstr(a.phone) || dstr(conv.customerPhone) });
    return { orderId: order.id, totalAmount: total };
  };
  // Trả lời khách trong hộp thư chatbot — chạy CỤC BỘ trên bản Windows (không
  // có Muse AI): ưu tiên câu đã dạy theo từ khóa, tra đơn theo SĐT, ngoài giờ
  // thì hẹn lại, khách giận thì trấn an + chuyển người thật. Câu hỏi ngoài
  // dữ liệu shop thì chuyển người thật kèm câu trấn an, không bịa câu trả lời.
  h.chatbotAsk = (a) => {
    const nowIso = new Date().toISOString();
    const finish = (reply, status, escalateReason, providerUsed) => {
      const conv = store.find("chatbotConversations", num(convId));
      const messages = parseMsgs(conv);
      messages.push({ role: "bot", text: reply, at: nowIso, provider: providerUsed });
      store.update("chatbotConversations", conv.id, { messagesJson: JSON.stringify(messages), status, escalateReason: status === "needs_human" ? dstr(escalateReason) : "" });
      return { reply, needsHuman: status === "needs_human", providerUsed };
    };
    let conv = null;
    let convId = 0;
    if (a.conversationId) {
      conv = store.find("chatbotConversations", num(a.conversationId));
      if (!conv) throw B.err("Không tìm thấy hội thoại.");
      convId = conv.id;
    } else {
      conv = store.insert("chatbotConversations", {
        platform: dstr(a.platform, "facebook"), customerName: dstr(a.customerName), customerPhone: dstr(a.customerPhone),
        status: "bot", escalateReason: "", messagesJson: "[]", orderId: 0,
      });
      convId = conv.id;
    }
    const msg = dstr(a.message);
    const messages = parseMsgs(conv);
    messages.push({ role: "customer", text: msg, at: nowIso });
    store.update("chatbotConversations", conv.id, { messagesJson: JSON.stringify(messages) });
    const settings = loadChatbotSettings();
    if (!settings.enabled) return finish("Dạ shop cảm ơn anh/chị đã nhắn tin ạ. Chatbot hiện đang tắt, shop sẽ trả lời anh/chị sớm nhất ạ.", "needs_human", "Chatbot đang tắt — chờ người thật trả lời", "");
    const now = vietnamNowHHMM();
    if (!inWorkHours(now, settings.workStart, settings.workEnd)) {
      const reply = settings.outsideMsg || CHATBOT_DEFAULTS.outsideMsg;
      return finish(reply, "bot", "", "Tự động (ngoài giờ)");
    }
    const lower = msg.toLowerCase();
    const angry = CHATBOT_ANGRY_WORDS.some((w) => lower.includes(w));
    if (angry) {
      return finish("Dạ shop rất xin lỗi vì trải nghiệm chưa tốt của anh/chị ạ. Shop đã chuyển tin nhắn này cho nhân viên để xử lý ngay và liên hệ lại anh/chị sớm nhất ạ.", "needs_human", "Khách đang giận/khiếu nại", "Tự động (chuyển người thật)");
    }
    // Tra đơn theo số điện thoại trong tin nhắn.
    const phoneMatch = msg.match(/(?:\+84|0)\d{8,9}/);
    if (phoneMatch && /đơn|tra|giao|ship|đặt/.test(lower)) {
      const phone = phoneMatch[0];
      const orders = store.all("orders").filter((o) => String(o.customerPhone || "") === phone).slice().sort((x, y) => String(y.orderDate || "").localeCompare(String(x.orderDate || "")));
      if (orders.length) {
        const o = orders[0];
        return finish(`Dạ shop tra thấy đơn ${o.externalCode || `CB-${o.id}`} của anh/chị đang ở trạng thái “${o.status}”, tổng ${num(o.totalAmount).toLocaleString("vi-VN")}đ ạ. Anh/chị cần đổi địa chỉ hay hỗ trợ gì thêm không ạ?`, "bot", "", "Tra đơn theo SĐT");
      }
      return finish("Dạ shop chưa tìm thấy đơn hàng nào với số điện thoại này ạ. Anh/chị kiểm tra lại số điện thoại giúp shop, hoặc gửi mã đơn để shop tra lại nhé ạ.", "bot", "", "Tra đơn theo SĐT");
    }
    // Câu trả lời đã dạy (khớp từ khóa hoặc câu hỏi).
    const knowledge = store.all("chatbotKnowledge").filter((k) => k.active !== 0);
    const hit = knowledge.find((k) => {
      const keys = String(k.keywords || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (keys.some((kw) => kw && lower.includes(kw))) return true;
      const q = String(k.question || "").toLowerCase();
      return q && (lower.includes(q) || q.split(/\s+/).filter((w) => w.length > 3).some((w) => lower.includes(w)));
    });
    if (hit) return finish(dstr(hit.answer), "bot", "", "Câu trả lời đã dạy");
    // Tư vấn theo hàng hóa thật trong kho (khớp tên sản phẩm trong tin nhắn).
    const invHit = store.all("inventory").find((i) => String(i.name || "").toLowerCase() && lower.includes(String(i.name).toLowerCase()));
    if (invHit) {
      return finish(`Dạ shop có “${invHit.name}” ạ, giá ${num(invHit.price).toLocaleString("vi-VN")}đ, còn ${num(invHit.stock)} sản phẩm trong kho. Anh/chị muốn đặt bao nhiêu ạ, cho shop xin tên, số điện thoại và địa chỉ để shop lên đơn nhé ạ.`, "bot", "", "Tư vấn theo kho hàng");
    }
    if (settings.greeting && messages.filter((m) => m.role === "customer").length <= 1) {
      return finish(`${settings.greeting} Anh/chị cần tư vấn sản phẩm nào, cứ nhắn cho shop nhé ạ.`, "bot", "", "Lời chào của shop");
    }
    return finish("Dạ cảm ơn anh/chị đã nhắn tin ạ. Câu hỏi này shop cần nhân viên tư vấn kỹ hơn, shop đã chuyển cho nhân viên rồi ạ, nhân viên sẽ trả lời anh/chị sớm nhất. Anh/chị cứ để lại số điện thoại để shop liên hệ lại nhé ạ.", "needs_human", "Câu hỏi khó — cần người thật", "Tự động (chuyển người thật)");
  };

  // ---------- Chat với Annie (khớp bản web v16) ----------
  const STEP_LABELS = { read: "Đọc sản phẩm", script: "Lập kịch bản", review: "Rà soát lời thoại", scene1: "Chốt ảnh cảnh 1", facelock: "Khóa khuôn mặt", scenes: "Ảnh từng cảnh", clip: "Dựng clip xem trước", voice: "Giọng đọc", assemble: "Ghép bản dựng", caption: "Caption & hashtag", done: "Hoàn tất" };
  const detectPlatform = (url) => {
    const u = (url || "").toLowerCase();
    if (u.includes("shopee")) return "shopee";
    if (u.includes("tiktok")) return "tiktokshop";
    if (u.includes("lazada")) return "lazada";
    if (u.includes("tiki")) return "tiki";
    return "manual";
  };
  h.getAnnieChat = () => {
    // Đối chiếu tiến độ thật cho từng việc chưa kết thúc.
    const taskRows = store.all("annieTasks").slice().sort((a, b) => num(b.id) - num(a.id)).slice(0, 50);
    for (const t of taskRows) {
      if (t.status === "done" || t.status === "failed") continue;
      let status = t.status, detail = t.detail, jobId = num(t.jobId);
      if (t.kind === "read-product" && num(t.productId) > 0) {
        const p = store.find("products", num(t.productId));
        if (!p) { status = "failed"; detail = "Sản phẩm đã bị xóa khỏi kho nên Annie dừng việc này."; }
        else if (p.status === "ready") { status = "done"; detail = `Đã đọc xong sản phẩm “${p.name}” — anh có thể bảo Annie “làm video cho sản phẩm này” hoặc mở tab Tạo video.`; }
        else if (p.status === "attention") { status = "needs_attention"; detail = `Chưa đọc được link: ${p.attentionReason || "trang sản phẩm chặn đọc tự động"} — anh mở link kiểm tra lại hoặc dán link khác cho Annie.`; }
        else { status = "running"; detail = "Annie đang mở trang sản phẩm và trích xuất tên, mô tả, lợi ích, biến thể và ảnh thật…"; }
      }
      if (t.kind === "video" && num(t.productId) > 0) {
        if (jobId <= 0) {
          const js = store.all("jobs").filter((j) => num(j.productId) === num(t.productId)).sort((a, b) => num(b.id) - num(a.id));
          const j = js[0];
          if (j && new Date(j.createdAt || 0).getTime() >= new Date(t.createdAt || 0).getTime() - 60000) jobId = j.id;
        }
        if (jobId > 0) {
          const j = store.find("jobs", jobId);
          if (j) {
            if (j.status === "done") { status = "done"; detail = `Video “${j.title}” đã làm xong — mở tab Tạo video → Ghép duyệt & đăng để xem, xuất file và đăng bài.`; }
            else if (j.status === "failed" || j.status === "cancelled") { status = "failed"; detail = `Video “${j.title}” dừng ở bước ${STEP_LABELS[j.currentStep] || j.currentStep}${j.error ? `: ${j.error}` : ""}. Anh mở chi tiết video để xem và chạy lại.`; }
            else if (j.status === "needs_attention") { status = "needs_attention"; detail = `Video “${j.title}” cần anh xử lý ở bước ${STEP_LABELS[j.currentStep] || j.currentStep}${j.error ? `: ${j.error}` : ""}.`; }
            else { status = "running"; detail = `Đang làm video “${j.title}” — bước hiện tại: ${STEP_LABELS[j.currentStep] || j.currentStep}.`; }
          }
        }
      }
      if (status !== t.status || detail !== t.detail || jobId !== num(t.jobId)) {
        store.update("annieTasks", t.id, { status, detail, jobId, seen: (status === "done" || status === "needs_attention") ? 0 : (t.seen ? 1 : 0) });
      }
    }
    const freshTasks = store.all("annieTasks").slice().sort((a, b) => num(b.id) - num(a.id)).slice(0, 50);
    const msgs = store.all("annieMessages").slice().sort((a, b) => num(a.id) - num(b.id)).slice(0, 200);
    return {
      messages: msgs.map((m) => ({ id: num(m.id), role: dstr(m.role), text: dstr(m.text), createdAt: dstr(m.createdAt, "") })),
      tasks: freshTasks.map((t) => ({ id: num(t.id), title: dstr(t.title), kind: dstr(t.kind, "note"), status: dstr(t.status, "queued"), detail: dstr(t.detail), productId: num(t.productId), jobId: num(t.jobId), seen: !!t.seen, createdAt: dstr(t.createdAt, ""), updatedAt: dstr(t.updatedAt, "") })),
    };
  };
  h.annieMarkTasksSeen = () => {
    for (const t of store.all("annieTasks")) if (!t.seen) store.update("annieTasks", t.id, { seen: 1 });
    return { ok: true };
  };
  h.annieDeleteTask = (a) => { store.remove("annieTasks", num(a.id)); return { ok: true }; };
  // Chat với Annie trên bản Windows: Annie trả lời bằng dữ liệu thật trong app.
  // Đọc link tự động và chạy pipeline AI cần Muse AI trên bản web — trên bản
  // Windows, Annie lưu link/sản phẩm và hướng dẫn anh chạy tiếp, không bịa
  // kết quả đọc link hay video đã xong.
  h.annieSendMessage = (a) => {
    const text = dstr(a.text).trim();
    if (!text) throw B.err("Anh chưa nhập tin nhắn.");
    store.insert("annieMessages", { role: "user", text });
    let reply = "";
    let taskId = 0;
    let productId = 0;
    const urlMatch = text.match(/https?:\/\/[^\s<>"')]+/i);
    const url = urlMatch ? urlMatch[0] : "";
    const isShopLink = url !== "" && (detectPlatform(url) !== "manual" || /shopee|tiktok|lazada|tiki/i.test(url));
    if (isShopLink) {
      const platform = detectPlatform(url);
      const product = store.insert("products", { sourceUrl: url, platform, status: "attention", attentionReason: "Bản Windows chưa tự đọc link sản phẩm được — cần Muse AI trên bản web. Anh mở link trên bản web để app đọc, hoặc nhập tên/mô tả sản phẩm tay trong tab Tạo video." });
      productId = product.id;
      const t = store.insert("annieTasks", { title: `Đọc link sản phẩm (${platform})`, kind: "read-product", status: "needs_attention", detail: "Bản Windows chưa tự đọc link được (cần Muse AI trên bản web). Anh mở link trên bản web để app đọc xong, rồi đồng bộ file sao lưu về Windows — hoặc nhập tên/mô tả tay trong tab Tạo video.", productId: product.id, seen: 0 });
      taskId = t.id;
      reply = "Annie đã lưu link vào kho sản phẩm rồi ạ, nhưng bản Windows chưa tự đọc link được vì bước đọc link cần Muse AI trên bản web. Anh mở link này trên bản web MODOLIVIO để app đọc xong (tên, mô tả, lợi ích, ảnh thật), rồi đồng bộ file sao lưu về Windows — hoặc nhập tên/mô tả sản phẩm tay trong tab Tạo video là Annie xếp việc làm video tiếp được ạ.";
    } else if (/(làm|tạo|dựng)\s*(video|clip)/i.test(text) || /video cho sản phẩm/i.test(text)) {
      const ready = store.all("products").filter((p) => p.status === "ready").sort((x, y) => num(y.id) - num(x.id))[0];
      if (ready) {
        productId = ready.id;
        const t = store.insert("annieTasks", { title: `Làm video cho “${ready.name}”`, kind: "video", status: "queued", detail: "Annie đã xếp việc. Anh bấm nút “Mở Tạo video — đã chọn sẵn sản phẩm này” ở thẻ việc bên dưới, kiểm tra nhân vật/giọng/nhạc rồi bấm Làm nhanh — pipeline chạy tới đâu Annie báo tiến độ tại đây tới đó. Lưu ý: trên bản Windows, bước Làm nhanh cần Muse AI nên anh chạy trên bản web, rồi mở lại dự án trên Windows để quản lý tiếp.", productId: ready.id });
        taskId = t.id;
        reply = `Annie xếp việc làm video cho “${ready.name}” rồi ạ. Sản phẩm này đã đọc xong và sẵn sàng. Anh bấm nút trong thẻ việc để mở Tạo video (sản phẩm đã chọn sẵn), bấm Làm nhanh là Annie theo dõi tiến độ và báo ngay khi video xong. Lưu ý nhỏ: trên bản Windows, bước Làm nhanh cần Muse AI nên anh chạy trên bản web, rồi mở lại dự án trên Windows để quản lý tiếp ạ.`;
      } else {
        reply = "Annie chưa thấy sản phẩm nào đã đọc xong để làm video ạ. Anh dán link sản phẩm Shopee/TikTok Shop/Lazada/Tiki vào đây, Annie lưu lại rồi anh mở link trên bản web để app đọc xong, sau đó bảo “làm video” là Annie xếp việc ngay.";
      }
    } else {
      // Trả lời bằng dữ liệu thật trong app (không bịa số liệu).
      const prods = store.all("products").slice().sort((x, y) => num(y.id) - num(x.id)).slice(0, 6);
      const jobRows = store.all("jobs").slice().sort((x, y) => num(y.id) - num(x.id)).slice(0, 6);
      const taskRows = store.all("annieTasks").slice().sort((x, y) => num(y.id) - num(x.id)).slice(0, 6);
      const socials = store.all("socialAccounts");
      const shopRows = store.all("shops");
      const lower = text.toLowerCase();
      if (/tiến độ|tiến triển|đang làm|tới đâu|đến đâu/.test(lower)) {
        const cur = jobRows[0];
        const open = taskRows.filter((t) => t.status !== "done" && t.status !== "failed");
        reply = cur
          ? `Annie đây ạ. Video gần nhất “${cur.title}” đang ở trạng thái ${cur.status}, bước ${STEP_LABELS[cur.currentStep] || cur.currentStep || "—"}. Việc đã giao Annie: ${open.length ? open.map((t) => `“${t.title}” (${t.status})`).join("; ") : "không còn việc nào đang làm"}.`
          : "Annie đây ạ. Hiện chưa có video nào trong app để báo tiến độ. Anh dán link sản phẩm cho Annie, Annie lưu lại rồi anh bảo “làm video” là Annie xếp việc ngay ạ.";
      } else if (/doanh thu|bán|đơn hàng|đơn|tiền|lãi/.test(lower)) {
        const orders = store.all("orders");
        const delivered = orders.filter((o) => o.status === "da-giao");
        const rev = delivered.reduce((s, o) => s + num(o.totalAmount), 0);
        reply = `Annie đây ạ. Trong app hiện có ${orders.length} đơn hàng, ${delivered.length} đơn đã giao, doanh thu từ đơn đã giao là ${rev.toLocaleString("vi-VN")}đ. Anh mở tab Bán hàng → Báo cáo để xem chi tiết theo kỳ và theo sàn ạ.`;
      } else {
        reply = `Annie đây ạ. Trong app lúc này: sản phẩm gần nhất ${prods.length ? `“${prods[0].name || prods[0].sourceUrl}” (${prods[0].status})` : "chưa có"}; video gần nhất ${jobRows.length ? `“${jobRows[0].title}” (${jobRows[0].status}, bước ${jobRows[0].currentStep || "—"})` : "chưa có"}; tài khoản MXH đã kết nối ${socials.filter((x) => x.status === "da-ket-noi").length}/${socials.length}; gian hàng đã kết nối ${shopRows.filter((x) => x.status === "da-ket-noi").length}/${shopRows.length}. Anh có thể dán link sản phẩm để Annie lưu, bảo “làm video” để Annie xếp việc cho sản phẩm đã đọc gần nhất, hoặc hỏi “tiến độ” để Annie báo video đang tới bước nào ạ.`;
      }
    }
    if (!reply) reply = "Annie đã nhận tin nhắn của anh rồi ạ.";
    store.insert("annieMessages", { role: "annie", text: reply });
    return { reply, taskId, productId };
  };

  // ---------- Đồng bộ đầy đủ web ↔ Windows bằng file sao lưu ----------
  h.exportAllData = () => B.exportBackup(store);
  h.importAllData = (a) => {
    let payload = a.data;
    if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { throw B.err("File sao lưu không phải JSON hợp lệ."); } }
    const counts = B.importBackup(store, payload);
    return { ok: true, ...counts };
  };

  return h;
}

function B_VOICE_PICK(region, gender) {
  const same = VOICE_PRESETS.filter((v) => v.region === region && v.gender === gender);
  const pool = same.length ? same : VOICE_PRESETS.filter((v) => v.gender === gender);
  return pool.slice(0, 3);
}
// VOICE_PRESETS dùng trong suggestVoicesForCharacter (định nghĩa ở bridge.js).
const { VOICE_PRESETS } = B;

async function handleAction(store, action, args) {
  const handlers = buildHandlers(store);
  const fn = handlers[action];
  if (!fn) throw B.err(`Action "${action}" chưa hỗ trợ trên bản Windows`);
  return fn(args || {});
}

module.exports = { buildHandlers, handleAction };
