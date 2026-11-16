"use strict";
const ports = Array.from({ length: 10 }, (_, i) => 19740 + i);
const $ = (id) => document.getElementById(id);
async function pair(port, code) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/auth/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || "Ghép nối thất bại");
  await chrome.storage.local.set({ ...data, port }); return data;
}
$("pair").onclick = async () => {
  try {
    const code = $("code").value.trim(); let last;
    for (const port of ports) { try { await pair(port, code); $("port").value = port; $("status").textContent = `Đã ghép nối cổng ${port}`; return; } catch (e) { last = e; } }
    throw last || new Error("Bridge Agent chưa chạy");
  } catch (e) { $("status").textContent = e.message; }
};
$("grab").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "EXTRACT" }, (response) => { $("status").textContent = chrome.runtime.lastError?.message || JSON.stringify(response || {}); });
};
