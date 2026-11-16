"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MuseProvider, createProviderRouter } = require("../p3/muse/museProvider.js");
const { createRenderRouter } = require("../p3/provider-selector.js");
const { MUSE_CHAT_SELECTORS, validateMuseJobHardGate } = require("../p3/muse/museCdpEngine.js");

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "mo-muse-source-")); }

test("Annie's Muse chat selectors match the supplied source; no guessed studio selectors", () => {
  assert.equal(MUSE_CHAT_SELECTORS.composer, "textarea");
  assert.match(MUSE_CHAT_SELECTORS.notLoggedInPane, /native-auth-access-pane/);
  assert.match(MUSE_CHAT_SELECTORS.statusPanel, /hatch-status-panel-sliding-surface/);
  assert.match(MUSE_CHAT_SELECTORS.stopButton, /hatch-composer-stop-button/);
  assert.match(MUSE_CHAT_SELECTORS.attachmentPresentation, /hatch-chat-attachment-presentation/);
  assert.equal(MUSE_CHAT_SELECTORS.agentBubble, ".hatch-agent-bubble-bg");
  assert.doesNotMatch(JSON.stringify(MUSE_CHAT_SELECTORS), /studio-workspace|scene-prompt-input/);
});

test("Muse's hard-gate rejects an unverified 90% face and accepts 97% mock", () => {
  const job = { bridgePort: 19740, compliancePassed: true, scenes: [{ sceneIndex: 1, durationSec: 10,
    voiceText: "Giới thiệu sản phẩm", hasMC: true, faceLockSimilarity: .9,
    preserveOriginalProductImage: true, priceTagOverlaySec: 0 }] };
  assert.throws(() => validateMuseJobHardGate(job), /Face Lock/);
  job.scenes[0].faceLockSimilarity = .97;
  assert.doesNotThrow(() => validateMuseJobHardGate(job));
});

test("Uploaded MuseProvider receives actual Face Lock score, scene and profile on fake engine", async (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const face = path.join(dir,"face.png"), product = path.join(dir,"product.png"), mp4=path.join(dir,"fake.mp4");
  for (const name of [face,product,mp4]) fs.writeFileSync(name,"local fixture only");
  let received;
  const fake = { async executeJob(job) {
    received = job;
    return [{ status: "RENDERED", localMp4Path: mp4 }];
  }};
  const provider = new MuseProvider({ dataDir: dir, engineFactory: () => fake, bridgePort: 19740 });
  const input = { jobId: "a", sceneIndex:0, profileId:"HY_SINH", imageUrl:"https://example.com/product.png",
    characterRefImagePath:face, originalProductImagePath:product,
    faceLockSimilarity:.973, prompt:"review", dialogue:"Xin chào" };
  await assert.rejects(provider.submit({...input, faceLockSimilarity:.91}), /Face Lock/);
  const result = await provider.submit(input);
  await new Promise(resolve => setImmediate(resolve));
  const status = await provider.getTask(result.taskId);
  assert.equal(status.status, "succeeded");
  assert.equal(status.localFile, mp4);
  assert.equal(received.preferredAccountId, "HY_SINH");
  assert.equal(received.scenes[0].faceLockSimilarity, .973);
});

test("Router sends only provider=muse to Muse; other requests to Seedance", async () => {
  const calls=[];
  const seedance={async submit(){calls.push("seedance");return{taskId:"seed-1"}},async getTask(){return{status:"succeeded"}}};
  const muse={async submit(){calls.push("muse");return{taskId:"muse-1"}},async getTask(){return{status:"succeeded"}}};
  const router=createProviderRouter({seedance,muse});
  assert.equal((await router.submit({provider:"muse"})).taskId,"muse-1");
  assert.equal((await router.submit({provider:"anything-else"})).taskId,"seed-1");
  assert.deepEqual(calls,["muse","seedance"]);
  const integration=createRenderRouter({enableMuse:true, museProvider:muse, seedanceProvider:seedance});
  await integration.submit({provider:"muse"});
  assert.equal(calls.at(-1),"muse");
});
