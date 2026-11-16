"use strict";

const SEEDANCE_MODEL = "dreamina-seedance-2-5-260628";
const DEFAULT_ARK_ENDPOINT = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";

class MissingApiKeyError extends Error {
  constructor(provider) { super(`Chưa có API key cho ${provider}`); this.code = "MISSING_API_KEY"; }
}

class SeedanceProvider {
  constructor({ apiKey = process.env.BYTEPLUS_ARK_API_KEY, endpoint = process.env.BYTEPLUS_ARK_ENDPOINT || DEFAULT_ARK_ENDPOINT, fetchImpl = fetch } = {}) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.fetch = fetchImpl;
  }
  async submit({ prompt, imageUrl, durationSec = 10, aspectRatio = "9:16" }) {
    if (!this.apiKey) throw new MissingApiKeyError("BytePlus Seedance 2.5 (BYTEPLUS_ARK_API_KEY)");
    if (durationSec < 4 || durationSec > 30) throw new Error("Seedance 2.5 hỗ trợ clip 4–30 giây");
    const response = await this.fetch(this.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: SEEDANCE_MODEL, content: [
        { type: "text", text: `${prompt}\nVertical ${aspectRatio}, Vietnamese speech, native audio.` },
        ...(imageUrl ? [{ type: "image_url", image_url: { url: imageUrl }, role: "first_frame" }] : []),
      ], generate_audio: true, ratio: aspectRatio, duration: durationSec, watermark: false }),
      signal: AbortSignal.timeout(45000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Seedance API ${response.status}: ${body.message || body.error?.message || "yêu cầu thất bại"}`);
    const taskId = body.id || body.task_id;
    if (!taskId) throw new Error("Seedance trả phản hồi không có task id");
    return { taskId, raw: body };
  }
  async getTask(taskId) {
    if (!this.apiKey) throw new MissingApiKeyError("BytePlus Seedance 2.5 (BYTEPLUS_ARK_API_KEY)");
    const endpoint = new URL(`${this.endpoint.replace(/\/$/, "")}/${encodeURIComponent(taskId)}`);
    const response = await this.fetch(endpoint, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(20000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Seedance task API ${response.status}: ${body.message || body.error?.message || "poll thất bại"}`);
    return body;
  }
}

class LocalTts {
  constructor({ baseUrl = process.env.MODOLIVIO_VIENEU_URL || "http://127.0.0.1:8123", fetchImpl = fetch } = {}) {
    this.baseUrl = new URL(baseUrl);
    if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(this.baseUrl.hostname)) throw new Error("TTS chỉ được kết nối loopback");
    this.fetch = fetchImpl;
  }
  async synthesize({ text, voice }) {
    const response = await this.fetch(new URL("/v1/audio/speech", this.baseUrl), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: text, voice }), signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`VieNeu-TTS trả mã ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

module.exports = { SEEDANCE_MODEL, MissingApiKeyError, SeedanceProvider, LocalTts };
