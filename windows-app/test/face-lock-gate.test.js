"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createFaceLockGate } = require("../p3/face-lock-gate.js");
const { RenderPipeline } = require("../p3/pipeline.js");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mo-face-gate-"));
  const reference = path.join(dir, "character_ref.png");
  const candidate = path.join(dir, "scene_01.png");
  const script = path.join(dir, "faceLockVerifier.py");
  for (const p of [reference, candidate, script]) fs.writeFileSync(p, "fixture");
  return { dir, scene: { characterReferenceImagePath: reference, sceneCharacterImagePath: candidate }, script };
}

test("Face Lock >= 95%, verifier PASS and exit 0: allowed", async (t) => {
  const f = fixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const calls = [];
  const gate = createFaceLockGate({ python: "python", script: f.script, run: async (...args) => {
    calls.push(args); return { stdout: JSON.stringify({ similarity_pct: 95.5, passed: true }) };
  } });
  assert.equal((await gate.verifyScene(f.scene, 0)).similarity_pct, 95.5);
  assert.deepEqual(calls[0][1], [f.script, f.scene.characterReferenceImagePath, f.scene.sceneCharacterImagePath]);
  assert.equal(calls[0][2].windowsHide, true);
});

test("Face Lock wrong face 71.40%: block, name the failed scene and images", async (t) => {
  const f = fixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const gate = createFaceLockGate({ python: "python", script: f.script, run: async () => {
    const e = new Error("exit 1"); e.code = 1; e.stdout = JSON.stringify({ similarity_pct: 71.4, passed: false }); throw e;
  } });
  await assert.rejects(gate.verifyScene(f.scene, 1), /Cảnh 2: Face Lock 71\.40%.*character_ref\.png.*scene_01\.png/);
});

test("Face Lock fails closed for forged PASS score, missing images, malformed stdout", async (t) => {
  const f = fixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const gate1 = createFaceLockGate({ python: "python", script: f.script, run: async () => ({ stdout: JSON.stringify({ similarity_pct: 94.99, passed: true }) }) });
  await assert.rejects(gate1.verifyScene(f.scene), /94\.99%/);
  await assert.rejects(gate1.verifyScene({ ...f.scene, sceneCharacterImagePath: path.join(f.dir, "missing.png") }), /ảnh cảnh không tồn tại/);
  const gate2 = createFaceLockGate({ python: "python", script: f.script, run: async () => ({ stdout: "not json" }) });
  await assert.rejects(gate2.verifyScene(f.scene), /JSON hợp lệ/);
});

test("Job enters queue only after every scene has passed Python Face Lock", async (t) => {
  const f = fixture(); t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const payload = { scenes: [{ ...f.scene, durationSec: 10, sourceImageUrl: "https://assets.test/toner.png", dialogue: "Thử dưỡng da tự nhiên", overlays: [] }] };
  const queue = { inserted: 0, enqueue(job) { this.inserted++; return job; } };
  let pass = false;
  const pipeline = new RenderPipeline({ queue, provider: {}, tts: {}, cacheDir: f.dir, verifyProductIdentity: () => true,
    faceLockGate: { verifyScene: async () => { if (!pass) throw new Error("Face Lock 70.00% < yêu cầu 95%"); return { passed: true }; } } });
  await assert.rejects(pipeline.enqueue(payload, "k1"), /Face Lock 70\.00%/);
  assert.equal(queue.inserted, 0);
  pass = true;
  assert.equal((await pipeline.enqueue(payload, "k2")).idempotencyKey, "k2");
  assert.equal(queue.inserted, 1);
});
