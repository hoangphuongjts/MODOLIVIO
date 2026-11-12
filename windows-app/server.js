// server.js — Máy chủ cục bộ của MODOLIVIO Windows (chỉ Node.js thuần, không dependency).
// - Phục vụ giao diện (renderer/) qua HTTP trên cổng loopback.
// - POST /actions: cầu nối dữ liệu cục bộ (xem handlers.js).
// - GET /uploads/*: file người dùng đã tải lên (ảnh, nhạc, logo).
// - GET /health: kiểm tra máy chủ + đường dẫn dữ liệu.
// Chạy độc lập để kiểm tra:  node server.js --port 8901 --data-dir <thư mục>
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { Store } = require("./bridge.js");
const { handleAction } = require("./handlers.js");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function createServer({ dataDir, rendererDir }) {
  const store = new Store(dataDir);

  function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
    res.end(body);
  }

  function sendFile(res, filePath) {
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream", "content-length": data.length });
      res.end(data);
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === "GET" && pathname === "/health") {
      return sendJson(res, 200, { ok: true, app: "MODOLIVIO Windows", version: "1.2.0-win1", dataDir, rendererDir });
    }

    if (req.method === "POST" && pathname === "/actions") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 30_000_000) req.destroy(); });
      req.on("end", async () => {
        let parsed;
        try { parsed = JSON.parse(body || "{}"); } catch { return sendJson(res, 400, { error: "Body không phải JSON hợp lệ" }); }
        const action = typeof parsed.action === "string" ? parsed.action : "";
        try {
          const data = await handleAction(store, action, parsed.args || {});
          sendJson(res, 200, { data });
        } catch (e) {
          sendJson(res, 200, { error: e && e.message ? e.message : String(e) });
        }
      });
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/uploads/")) {
      const rel = pathname.slice("/uploads/".length);
      if (rel.includes("..")) { res.writeHead(400); res.end("Bad path"); return; }
      return sendFile(res, path.join(store.uploadsDir, rel));
    }

    if (req.method === "GET") {
      // Trang giao diện: file tĩnh trong renderer/ (index.html ở gốc).
      let rel = pathname === "/" ? "index.html" : pathname.slice(1);
      if (rel.includes("..")) { res.writeHead(400); res.end("Bad path"); return; }
      const filePath = path.join(rendererDir, rel);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return sendFile(res, filePath);
      // SPA fallback: mọi đường dẫn khác trả về index.html.
      return sendFile(res, path.join(rendererDir, "index.html"));
    }

    res.writeHead(405);
    res.end("Method not allowed");
  });

  return { server, store };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf("--port");
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) || 8901 : 8901;
  const dirIdx = args.indexOf("--data-dir");
  const dataDir = dirIdx >= 0 ? args[dirIdx + 1] : path.join(__dirname, "data");
  const { server } = createServer({ dataDir, rendererDir: path.join(__dirname, "renderer") });
  server.listen(port, "127.0.0.1", () => {
    console.log(`MODOLIVIO Windows local server: http://127.0.0.1:${port}/ (data: ${dataDir})`);
  });
}

module.exports = { createServer };
