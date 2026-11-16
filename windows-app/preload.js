// preload.js — Cầu nối an toàn giữa giao diện web và Electron (contextIsolation).
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("modolivio", {
  version: "1.3.0-win1",
  platform: "windows",
  getInfo: () => ipcRenderer.invoke("modolivio:get-info"),
  openDataFolder: () => ipcRenderer.invoke("modolivio:open-data-folder"),
  // Kiểm tra công cụ cục bộ: FFmpeg (ghép/xuất video) và máy chủ VieNeu-TTS.
  checkTools: () => ipcRenderer.invoke("modolivio:check-tools"),
  getBridgeStatus: () => ipcRenderer.invoke("modolivio:bridge-status"),
  openMuseSignIn: (profileId) => ipcRenderer.invoke("modolivio:muse-open-sign-in", profileId),
  getMuseVaultStatus: () => ipcRenderer.invoke("modolivio:muse-session-vault-status"),
  confirmMuseSignIn: (profileId) => ipcRenderer.invoke("modolivio:muse-confirm-sign-in", profileId),
  onBridgeEvent: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("modolivio:bridge-event", listener);
    return () => ipcRenderer.removeListener("modolivio:bridge-event", listener);
  },
});
