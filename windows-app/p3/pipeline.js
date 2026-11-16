"use strict";

const { randomUUID } = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const runFile = promisify(execFile);

const MAX_SCENES = 20;
/** @param {any} job @param {(scene: any) => boolean} verifyFaceLock @param {(scene: any) => boolean} verifyProductIdentity */
function validateJob(job, verifyFaceLock = () => false, verifyProductIdentity = () => false) {
  if (!job || !Array.isArray(job.scenes) || !job.scenes.length || job.scenes.length > MAX_SCENES) throw new Error("Job phải có 1–20 cảnh");
  for (const [i, scene] of job.scenes.entries()) {
    if (scene.durationSec !== 10) throw new Error(`Cảnh ${i + 1}: thời lượng phải đúng 10 giây`);
    if (!String(scene.dialogue || "").trim()) throw new Error(`Cảnh ${i + 1}: thiếu lời thoại để tổng hợp giọng cục bộ`);
    if (!verifyFaceLock(scene)) throw new Error(`Cảnh ${i + 1}: chưa có xác nhận Face Lock đáng tin cậy >= 0.95`);
    if (!scene.sourceImageUrl) throw new Error(`Cảnh ${i + 1}: thiếu ảnh gốc sản phẩm`);
    let sourceImage;
    try { sourceImage = new URL(scene.sourceImageUrl); } catch { throw new Error(`Cảnh ${i + 1}: URL ảnh gốc không hợp lệ`); }
    if (sourceImage.protocol !== "https:") throw new Error(`Cảnh ${i + 1}: ảnh gốc phải dùng HTTPS`);
    if (!verifyProductIdentity(scene)) throw new Error(`Cảnh ${i + 1}: chưa xác minh sản phẩm giữ nguyên ảnh gốc`);
    if (scene.overlays?.length) throw new Error(`Cảnh ${i + 1}: cấm mọi chữ, phụ đề, logo, giỏ hàng và tem chèn lên video`);
    if (scene.priceBadgeDurationSec > 3) throw new Error(`Cảnh ${i + 1}: tem sản phẩm vượt 3 giây`);
    const pricePattern = /(?:₫|\bVND\b|\bđồng\b|\bgiá\s*[:：]?\s*)\s*[\d.,]+/i;
    if (pricePattern.test(scene.dialogue || "") || pricePattern.test(scene.caption || "")) throw new Error(`Cảnh ${i + 1}: không cho phép giá số trong lời thoại/caption`);
  }
  return true;
}

class RenderPipeline {
  constructor({ queue, provider, tts, ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg", cacheDir, exportsDir = cacheDir, onEvent = /** @type {(event: any) => void} */ (() => {}), verifyFaceLock = null, faceLockGate = null, verifyProductIdentity = null, assertProfileAllowed = /** @type {(profileId: string) => boolean} */ (() => true) }) {
    this.queue = queue; this.provider = provider; this.tts = tts; this.ffmpegPath = ffmpegPath;
    this.cacheDir = cacheDir; this.exportsDir = exportsDir; this.onEvent = onEvent; this.running = false; this.stopping = false;
    this.faceLockGate = faceLockGate;
    this.verifyFaceLock = faceLockGate ? (() => true) : (verifyFaceLock || (() => false));
    this.verifyProductIdentity = verifyProductIdentity || (() => false);
    this.assertProfileAllowed = assertProfileAllowed;
  }
  async enqueue(payload, idempotencyKey) {
    // Validate the complete job before queue insertion (no fake face attestation).
    this.validate(payload);
    if (this.faceLockGate) {
      for (const [index, scene] of payload.scenes.entries()) await this.faceLockGate.verifyScene(scene, index);
    }
    return this.queue.enqueue({ id: randomUUID(), idempotencyKey, payload });
  }
  validate(payload) { return validateJob(payload, this.verifyFaceLock, this.verifyProductIdentity); }
  async pump() {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      let job;
      while (!this.stopping && (job = this.queue.claimNext())) {
        await this.process(job);
      }
    } finally { this.running = false; }
  }
  async process(job) {
    const payload = JSON.parse(job.payload);
    try {
      const parts = JSON.parse(job.scene_outputs || "[]");
      const failures = parts.map((part, index) => part && typeof part === "object" ? { index, error: part.error } : null).filter(Boolean);
      fs.mkdirSync(this.cacheDir, { recursive: true }); fs.mkdirSync(this.exportsDir, { recursive: true });
      for (let index = job.scene_index || 0; index < payload.scenes.length; index++) {
        const scene = payload.scenes[index];
        this.assertProfileAllowed(payload.profileId);
        this.onEvent({ type: "scene", jobId: job.id, index, state: "rendering" });
        try {
          let taskId = job.provider_task_id;
          if (!taskId) {
            // Re-check files immediately before provider submission; they may have changed while queued.
            if (this.faceLockGate) await this.faceLockGate.verifyScene(scene, index);
            const submitted = await this.provider.submit({ prompt: scene.prompt, imageUrl: scene.sourceImageUrl, durationSec: 10, aspectRatio: "9:16" });
            taskId = submitted.taskId;
            this.queue.setProviderTask(job.id, taskId);
          }
          const deadline = Date.now() + 15 * 60_000;
          let videoUrl;
          while (Date.now() < deadline && !this.stopping) {
            this.assertProfileAllowed(payload.profileId);
            const status = await this.provider.getTask(taskId);
            const state = status.status || status.task_status;
            if (state === "failed") throw new Error(`Seedance task lỗi: ${status.error?.message || status.error || "không rõ lỗi"}`);
            if (state === "succeeded") { videoUrl = findVideoUrl(status); break; }
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
          if (this.stopping) return;
          if (!videoUrl) throw new Error("Seedance chưa hoàn tất trong 15 phút hoặc không trả video_url");
          const sceneFile = await this.downloadVideo(videoUrl, job.id, index);
          const narration = await this.tts.synthesize({ text: scene.dialogue || "", voice: scene.voice });
          const audioFile = path.join(this.cacheDir, `${job.id}-${index}.wav`);
          fs.writeFileSync(audioFile, narration);
          const normalized = path.join(this.exportsDir, `${job.id}-scene-${String(index + 1).padStart(2, "0")}-1080x1920.mp4`);
          await runFile(this.ffmpegPath, ["-y", "-i", sceneFile, "-i", audioFile, "-filter_complex", "[0:a]volume=0.35[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]", "-map", "0:v:0", "-map", "[a]", "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1", "-t", "10", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", normalized], { timeout: 180000 });
          parts[index] = normalized;
          this.onEvent({ type: "scene", jobId: job.id, index, state: "done", output: normalized });
        } catch (error) {
          if (this.stopping) return;
          if (String(error.message || error).includes("Safety circuit is open")) throw error;
          const failure = { state: "failed", error: String(error.message || error).slice(0, 1000) };
          parts[index] = failure; failures.push({ index, error: failure.error });
          this.onEvent({ type: "scene", jobId: job.id, index, state: "failed", error: failure.error });
        }
        this.queue.saveSceneOutput(job.id, parts[index]);
        job.provider_task_id = null; job.scene_index = index + 1; job.scene_outputs = JSON.stringify(parts);
      }
      const successfulParts = parts.filter((part) => typeof part === "string");
      if (!successfulParts.length) throw new Error("Không có cảnh nào render thành công");
      const listFile = path.join(this.cacheDir, `${job.id}-concat.txt`);
      fs.writeFileSync(listFile, successfulParts.map((part) => `file '${part.replace(/'/g, "'\\''")}'`).join("\n"));
      const output = path.join(this.exportsDir, `${job.id}${failures.length ? "-PARTIAL" : "-final"}-1080x1920.mp4`);
      await runFile(this.ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", output], { timeout: 180000 });
      const result = { parts, output, resolution: "1080x1920", failures };
      if (failures.length) {
        this.queue.fail(job.id, `${failures.length} cảnh lỗi; đã xuất file một phần có nhãn PARTIAL`, result);
        this.onEvent({ type: "job", jobId: job.id, state: "partial", output, failures });
      } else {
        this.queue.complete(job.id, result);
        this.onEvent({ type: "job", jobId: job.id, state: "done", output });
      }
    } catch (error) { this.queue.fail(job.id, error.message); this.onEvent({ type: "job", jobId: job.id, state: "failed", error: error.message }); }
  }
  async downloadVideo(videoUrl, jobId, sceneIndex) {
    const url = new URL(videoUrl);
    if (url.protocol !== "https:" || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i.test(url.hostname)) throw new Error("Seedance trả URL video không an toàn");
    const response = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: "error" });
    if (!response.ok) throw new Error(`Không tải được video Seedance: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1024 || bytes.length > 1024 ** 3) throw new Error("Kích thước video trả về không hợp lệ");
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const output = path.join(this.cacheDir, `${jobId}-${sceneIndex}-seedance.mp4`);
    fs.writeFileSync(output, bytes); return output;
  }
  async verifyFfmpeg() {
    const { stdout } = await runFile(this.ffmpegPath, ["-version"], { timeout: 5000 });
    return stdout.split("\n")[0];
  }
  async stop() { this.stopping = true; while (this.running) await new Promise((resolve) => setTimeout(resolve, 25)); }
}

function findVideoUrl(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.video_url === "string") return value.video_url;
  if (value.video_url && typeof value.video_url.url === "string") return value.video_url.url;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) { for (const item of child) { const found = findVideoUrl(item); if (found) return found; } }
    else if (child && typeof child === "object") { const found = findVideoUrl(child); if (found) return found; }
  }
  return null;
}

module.exports = { MAX_SCENES, validateJob, findVideoUrl, RenderPipeline };
