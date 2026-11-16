"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveRenderProvider, createRenderRouter } = require("../p3/provider-selector.js");
const { SeedanceProvider } = require("../p3/providers.js");

test('Non-"muse" selection keeps the existing Seedance provider', () => {
  assert.ok(resolveRenderProvider("seedance") instanceof SeedanceProvider);
  assert.ok(resolveRenderProvider("other") instanceof SeedanceProvider);
});

test('Muse source is available but requires an explicit Bridge dataDir', () => {
  assert.throws(() => resolveRenderProvider("muse"), /explicit Bridge dataDir/);
  const dir = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "mo-muse-"));
  try {
    assert.throws(() => resolveRenderProvider("muse", { dataDir: dir }), /MUSE_PROFILE_NOT_APPROVED/);
    const provider = resolveRenderProvider("muse", { dataDir: dir, allowedProfileId: "HY_SINH" });
    assert.equal(typeof provider.submit, "function");
  } finally { require("fs").rmSync(dir, { recursive: true, force: true }); }
});

test('Muse selection accepts a real externally injected provider interface', () => {
  const provider = { async submit() {}, async getTask() {} };
  assert.equal(resolveRenderProvider("muse", { museProvider: provider }), provider);
  assert.throws(() => resolveRenderProvider("muse", { museProvider: {} }), /submit\(\) and getTask\(\)/);
});

test("Muse disabled refuses a Muse job; never sends it to Seedance", async () => {
  let submitted = 0;
  const router = createRenderRouter({ seedanceProvider: {
    async submit() { submitted++; return { taskId: "seedance-1" }; },
    async getTask() { return { status: "succeeded" }; },
  } });
  await assert.rejects(router.submit({ provider: "muse" }), /disabled/);
  assert.equal(submitted, 0);
  assert.equal((await router.submit({ provider: "seedance" })).taskId, "seedance-1");
  assert.equal(submitted, 1);
});
