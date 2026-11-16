"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RenderPipeline } = require("../p3/pipeline.js");

test("Bridge pipeline forwards verified local Face Lock score, HY_SINH profile and scene metadata to Muse", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mo-pipeline-muse-"));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const fields=[];
  const queue = {
    enqueue(job) { return job; },
    setProviderTask() {}, saveSceneOutput() {}, fail() {}, complete() {},
  };
  const provider = {
    async submit(data) { fields.push(data); return { taskId: "muse_mock_1" }; },
    async getTask() { return { status: "failed", error: "mock-only: no live Muse access" }; },
  };
  const faceGate = { async verifyScene() { return { passed:true, similarity_pct:96.3 }; } };
  const pipeline = new RenderPipeline({ queue, provider, tts:{}, cacheDir:dir, faceLockGate:faceGate,
    verifyProductIdentity:()=>true });
  const payload = { provider:"muse", profileId:"HY_SINH", scenes:[{
    durationSec:10, dialogue:"Giới thiệu sản phẩm", prompt:"Review 10 giây",
    sourceImageUrl:"https://example.com/product.png",
    characterReferenceImagePath:path.join(dir,"ref.png"),
    sceneImagePath:path.join(dir,"scene.png"),
    originalProductImagePath:path.join(dir,"product.png"), overlays:[],
  }]};
  const queued = await pipeline.enqueue(payload,"idempotent-key");
  assert.ok(queued.id);
  await pipeline.process({ id:queued.id, payload:JSON.stringify(payload), scene_index:0, scene_outputs:"[]" });
  assert.equal(fields.length,1);
  assert.equal(fields[0].provider,"muse");
  assert.equal(fields[0].profileId,"HY_SINH");
  assert.equal(fields[0].faceLockSimilarity,.963);
  assert.equal(fields[0].characterRefImagePath,payload.scenes[0].characterReferenceImagePath);
  assert.equal(fields[0].originalProductImagePath,payload.scenes[0].originalProductImagePath);
});
