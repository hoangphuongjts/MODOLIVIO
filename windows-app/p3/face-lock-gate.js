"use strict";

// Face Lock preflight. No image or face embedding leaves this machine.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const runFile = promisify(execFile);
const FACE_LOCK_THRESHOLD_PCT = 95;

function discoverLocalVenvPython(exists) {
  const suffix = process.platform === "win32" ? path.join("Scripts","python.exe") : path.join("bin","python");
  const roots = [
    path.resolve(__dirname, "../muse-engine/python/.venv"),
    path.resolve(__dirname, "../muse-engine/python/venv"),
    path.resolve(__dirname, "../.venv"),
    path.resolve(__dirname, "../venv")
  ];
  return roots.map(root=>path.join(root,suffix)).find(exists) || null;
}

function createFaceLockGate({
  python = process.env.MODOLIVIO_FACELOCK_PYTHON,
  script = path.resolve(__dirname, "../muse-engine/python/faceLockVerifier.py"),
  thresholdPct = FACE_LOCK_THRESHOLD_PCT,
  run = runFile,
  exists = fs.existsSync,
} = {}) {
  if (!Number.isFinite(thresholdPct) || thresholdPct < 0 || thresholdPct > 100) throw new Error("Face Lock threshold không hợp lệ");
  return {
    async verifyScene(scene, sceneIndex = 0) {
      const reference = scene?.characterReferenceImagePath || scene?.characterRefImagePath;
      const candidate = scene?.sceneCharacterImagePath || scene?.sceneImagePath;
      const label = `Cảnh ${sceneIndex + 1}`;
      if (!reference || !candidate) throw new Error(`${label}: Face Lock thiếu đường dẫn ảnh nhân vật gốc hoặc ảnh cảnh`);
      for (const [kind, filename] of [["gốc", reference], ["cảnh", candidate]]) {
        if (typeof filename !== "string" || filename.includes("\0") || !path.isAbsolute(filename) || !exists(filename)) {
          throw new Error(`${label}: ảnh ${kind} không tồn tại hoặc không phải đường dẫn local tuyệt đối: ${String(filename).slice(0, 160)}`);
        }
      }
      const interpreter = python || discoverLocalVenvPython(exists);
      if (!interpreter || typeof interpreter !== "string" || !exists(script)) {
        throw new Error(`${label}: Face Lock BLOCKED: chưa cấu hình Python verifier / faceLockVerifier.py`);
      }
      let stdout = "";
      let exitCode = 0;
      try {
        const result = await run(interpreter, [script, reference, candidate], {
          timeout: 60_000, maxBuffer: 1_000_000, windowsHide: true,
        });
        stdout = result.stdout;
      } catch (error) {
        stdout = typeof error.stdout === "string" ? error.stdout : "";
        exitCode = Number.isInteger(error.code) ? error.code : -1;
        if (exitCode !== 1) throw new Error(`${label}: Face Lock verifier lỗi chạy (${String(error.code || error.message).slice(0, 100)})`);
      }
      let result;
      try { result = JSON.parse(String(stdout || "").trim()); }
      catch { throw new Error(`${label}: Face Lock verifier không trả JSON hợp lệ`); }
      const score = Number(result.similarity_pct);
      if (!Number.isFinite(score) || score < 0 || score > 100 || typeof result.passed !== "boolean") {
        throw new Error(`${label}: kết quả Face Lock không hợp lệ`);
      }
      if (exitCode !== 0 || result.passed !== true || score < thresholdPct) {
        const reason = String(result.error || "Verifier báo không đạt").replace(/\s+/g," ").slice(0,160);
        throw new Error(`${label}: Face Lock ${score.toFixed(2)}% < yêu cầu ${thresholdPct}% hoặc verifier từ chối; lý do: ${reason}. Ảnh gốc: ${path.basename(reference)}; ảnh cảnh: ${path.basename(candidate)}`);
      }
      return { passed: true, similarity_pct: score, reference: path.basename(reference), candidate: path.basename(candidate) };
    },
  };
}

module.exports = { FACE_LOCK_THRESHOLD_PCT, createFaceLockGate };
