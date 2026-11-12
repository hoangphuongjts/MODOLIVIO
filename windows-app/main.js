// main.js — Tiến trình chính của MODOLIVIO Windows (Electron).
"use strict";

const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { createServer } = require("./server.js");

const APP_VERSION = "1.2.0-win1";
const SMOKE_TEST = process.argv.includes("--smoke-test");

let mainWindow = null;
let localServer = null;
let localPort = 0;
let dataDir = "";
let localStore = null;

function dataDirFor() {
  return path.join(app.getPath("userData"), "MODOLIVIO");
}

async function startLocalServer() {
  dataDir = dataDirFor();
  const { server, store } = createServer({ dataDir, rendererDir: path.join(__dirname, "renderer") });
  localServer = server;
  localStore = store;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      localPort = server.address().port;
      resolve();
    });
  });
}

function buildMenu() {
  const template = [
    {
      label: "Tệp",
      submenu: [
        { label: "Mở thư mục dữ liệu", click: () => shell.openPath(dataDir) },
        { label: "Mở thư mục tải lên", click: () => shell.openPath(path.join(dataDir, "uploads")) },
        { type: "separator" },
        { label: "Thoát", role: "quit" },
      ],
    },
    {
      label: "Đồng bộ",
      submenu: [
        {
          label: "Xuất bản sao lưu đầy đủ (đồng bộ sang bản web)",
          click: async () => {
            const { exportBackup } = require("./bridge.js");
            const file = await dialog.showSaveDialog(mainWindow, {
              title: "Xuất bản sao lưu đầy đủ MODOLIVIO",
              defaultPath: `modolivio-backup-${new Date().toISOString().slice(0, 10)}.json`,
              filters: [{ name: "Bản sao lưu MODOLIVIO", extensions: ["json"] }],
            });
            if (file.canceled || !file.filePath) return;
            fs.writeFileSync(file.filePath, JSON.stringify(exportBackup(localStore), null, 2), "utf8");
            dialog.showMessageBox(mainWindow, {
              type: "info", title: "Đã xuất bản sao lưu",
              message: "Đã xuất toàn bộ dữ liệu ra file.",
              detail: "Mang file này sang bản còn lại và chọn Đồng bộ → Nhập bản sao lưu đầy đủ để gộp dữ liệu vào.\nLưu ý: file không mang theo ảnh/nhạc đã tải lên (nằm trong thư mục uploads của từng máy).",
            });
          },
        },
        {
          label: "Nhập bản sao lưu đầy đủ (gộp dữ liệu từ bản web)",
          click: async () => {
            const { importBackup } = require("./bridge.js");
            const picked = await dialog.showOpenDialog(mainWindow, {
              title: "Nhập bản sao lưu đầy đủ MODOLIVIO",
              filters: [{ name: "Bản sao lưu MODOLIVIO", extensions: ["json"] }],
              properties: ["openFile"],
            });
            if (picked.canceled || !picked.filePaths[0]) return;
            const answer = await dialog.showMessageBox(mainWindow, {
              type: "question", title: "Nhập bản sao lưu",
              message: "Gộp dữ liệu từ file sao lưu vào máy này?",
              detail: "Mục nào cùng mã sẽ ghi đè bằng bản mới hơn, mục mới sẽ được thêm vào. Dữ liệu hiện có trên máy không bị xóa.",
              buttons: ["Gộp dữ liệu", "Hủy"], defaultId: 0, cancelId: 1,
            });
            if (answer.response !== 0) return;
            try {
              const payload = JSON.parse(fs.readFileSync(picked.filePaths[0], "utf8"));
              const counts = importBackup(localStore, payload);
              dialog.showMessageBox(mainWindow, {
                type: "info", title: "Đã nhập xong",
                message: `Đã gộp dữ liệu: thêm mới ${counts.added} mục, cập nhật ${counts.updated} mục.`,
                detail: "Tải lại app (Xem → Tải lại) để thấy dữ liệu mới. Ảnh/nhạc tải lên không nằm trong file sao lưu nên cần chép tay thư mục uploads nếu cần.",
              });
            } catch (e) {
              dialog.showErrorBox("Không nhập được", e.message || String(e));
            }
          },
        },
        { type: "separator" },
        {
          label: "Đồng bộ hoạt động thế nào?",
          click: () => dialog.showMessageBox(mainWindow, {
            type: "info", title: "Đồng bộ web ↔ Windows",
            message: "Đồng bộ bằng file sao lưu đầy đủ (chưa có đồng bộ tự động qua mạng).",
            detail: "Bản web và bản Windows chưa có máy chủ đám mây chung để tự đồng bộ. Cách dùng: ở bản này chọn Đồng bộ → Xuất bản sao lưu đầy đủ, sang bản kia chọn Đồng bộ → Nhập bản sao lưu đầy đủ (trên bản web: dùng nút Xuất/Nhập file dự án cho từng dự án, hoặc nhập file sao lưu đầy đủ qua bản Windows).\n\nTài khoản MODOLIVIO: đăng ký cùng email + mật khẩu ở cả hai bản là đăng nhập được cả hai (cùng thuật toán băm mật khẩu).",
          }),
        },
      ],
    },
    {
      label: "Xem",
      submenu: [
        { label: "Tải lại", role: "reload" },
        { label: "Phóng to", role: "zoomIn" },
        { label: "Thu nhỏ", role: "zoomOut" },
        { label: "Cỡ chữ mặc định", role: "resetZoom" },
        { type: "separator" },
        { label: "Toàn màn hình", role: "togglefullscreen" },
        { label: "Công cụ nhà phát triển", role: "toggleDevTools" },
      ],
    },
    {
      label: "Trợ giúp",
      submenu: [
        {
          label: "Hướng dẫn sử dụng",
          click: () => shell.openExternal("https://muse.ai"),
        },
        {
          label: `Về MODOLIVIO ${APP_VERSION}`,
          click: () => dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Về MODOLIVIO",
            message: `MODOLIVIO ${APP_VERSION} — App Video Bán Hàng (bản Windows)`,
            detail: "Bản Windows chạy cục bộ trên máy của bạn: giao diện và quản lý dữ liệu dùng được ngoại tuyến.\n\nĐồng bộ với bản web: dùng menu Đồng bộ → Xuất/Nhập bản sao lưu đầy đủ (chưa có đồng bộ tự động qua mạng — xem HUONG-DAN.md).\n\nTính năng cần Muse AI (Làm nhanh, tạo ảnh/clip bằng AI) và đăng bài tự động cần bản web / tài khoản đã kết nối — xem file HUONG-DAN.md kèm theo.",
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const iconPng = path.join(__dirname, "assets", "icon.png");
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: "MODOLIVIO — App Video Bán Hàng",
    icon: fs.existsSync(iconPng) ? iconPng : undefined,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${localPort}/`);
  mainWindow.on("closed", () => { mainWindow = null; });

  // Mở link ngoài bằng trình duyệt mặc định, không mở trong app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith(`http://127.0.0.1:${localPort}`)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (SMOKE_TEST) {
    const errors = [];
    mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
      if (level === "error") errors.push(`${sourceId}:${line}: ${message}`);
    });
    mainWindow.webContents.on("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const shot = await mainWindow.webContents.capturePage();
          const out = process.env.SMOKE_SHOT || path.join(app.getPath("temp"), "modolivio-smoke.png");
          fs.writeFileSync(out, shot.toPNG());
          const state = await mainWindow.webContents.executeJavaScript(
            "({ title: document.title, rootChildren: (document.querySelector('[data-generated-space-root]')||{}).children.length, bodyText: document.body.innerText.slice(0, 400) })",
            true,
          );
          fs.writeFileSync(path.join(app.getPath("temp"), "modolivio-smoke.json"), JSON.stringify({ errors, state }, null, 2));
          console.log("SMOKE-TEST state:", JSON.stringify(state));
          console.log("SMOKE-TEST console errors:", errors.length ? JSON.stringify(errors) : "none");
        } catch (e) {
          console.log("SMOKE-TEST failed:", e.message);
          process.exitCode = 1;
        }
        app.quit();
      }, 6000);
    });
  }
}

ipcMain.handle("modolivio:get-info", () => ({
  version: APP_VERSION,
  platform: process.platform,
  dataDir,
  localPort,
  vieneuUrl: "http://127.0.0.1:8000",
}));

ipcMain.handle("modolivio:open-data-folder", async () => {
  await shell.openPath(dataDir);
  return true;
});

ipcMain.handle("modolivio:check-tools", async () => {
  const out = { ffmpeg: false, ffmpegPath: "", vieneuRunning: false, vieneuError: "" };
  await new Promise((resolve) => {
    execFile("ffmpeg", ["-version"], { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout) { out.ffmpeg = true; out.ffmpegPath = "ffmpeg (trong PATH)"; }
      resolve();
    });
  });
  try {
    const res = await fetch("http://127.0.0.1:8000/v1/voices", { signal: AbortSignal.timeout(5000) });
    out.vieneuRunning = res.ok;
    if (!res.ok) out.vieneuError = `Máy chủ VieNeu-TTS trả mã ${res.status}`;
  } catch {
    out.vieneuError = "Máy chủ VieNeu-TTS chưa chạy ở http://127.0.0.1:8000";
  }
  return out;
});

app.whenReady().then(async () => {
  await startLocalServer();
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (localServer) localServer.close();
  if (process.platform !== "darwin") app.quit();
});
