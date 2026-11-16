"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveRenderProvider } = require("../p3/provider-selector.js");
const { SeedanceProvider } = require("../p3/providers.js");

test('Non-"muse" selection keeps the existing Seedance provider', () => {
  assert.ok(resolveRenderProvider("seedance") instanceof SeedanceProvider);
  assert.ok(resolveRenderProvider("other") instanceof SeedanceProvider);
});

test('Muse selection fails closed when Annie source is absent', () => {
  assert.throws(() => resolveRenderProvider("muse"), (error) => error.code === "MUSE_SOURCE_MISSING");
});

test('Muse selection accepts a real externally injected provider interface', () => {
  const provider = { async submit() {}, async getTask() {} };
  assert.equal(resolveRenderProvider("muse", { museProvider: provider }), provider);
  assert.throws(() => resolveRenderProvider("muse", { museProvider: {} }), /submit\(\) and getTask\(\)/);
});
