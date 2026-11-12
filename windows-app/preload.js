// preload.js — Cầu nối an toàn giữa giao diện web và Electron (contextIsolation).
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("modolivio", {
  version: "1.0.0-win1",
  platform: "windows",
  getInfo: () => ipcRenderer.invoke("modolivio:get-info"),
  openDataFolder: () => ipcRenderer.invoke("modolivio:open-data-folder"),
  // Kiểm tra công cụ cục bộ: FFmpeg (ghép/xuất video) và máy chủ VieNeu-TTS.
  checkTools: () => ipcRenderer.invoke("modolivio:check-tools"),
});
