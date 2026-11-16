"use strict";

// Safe selection adapter. This does not recreate Annie's museProvider.js.
// It requires the actual provider source to be supplied for the "muse" route.
const fs = require("node:fs");
const path = require("node:path");
const { SeedanceProvider } = require("./providers.js");

function assertProvider(provider, kind) {
  if (!provider || typeof provider.submit !== "function" || typeof provider.getTask !== "function") {
    throw new Error(`${kind} provider must expose submit() and getTask() to the current Bridge pipeline`);
  }
  return provider;
}

function resolveRenderProvider(kind = process.env.MODOLIVIO_RENDER_PROVIDER || "seedance", options = {}) {
  if (kind !== "muse") return assertProvider(options.seedanceProvider || new SeedanceProvider(), "Seedance");
  if (options.museProvider) return assertProvider(options.museProvider, "Muse");

  const source = path.join(__dirname, "muse", "museProvider.js");
  if (!fs.existsSync(source)) {
    const error = new Error("MUSE_SOURCE_MISSING: Annie's museProvider.js is not in this handoff ZIP; Muse jobs are blocked, never sent to Seedance");
    error.code = "MUSE_SOURCE_MISSING";
    throw error;
  }

  // Once the real module is synchronized, validate its contract before exposing it.
  const moduleExports = require(source);
  const provider = typeof moduleExports.createMuseProvider === "function"
    ? moduleExports.createMuseProvider()
    : typeof moduleExports.MuseProvider === "function"
      ? new moduleExports.MuseProvider()
      : null;
  return assertProvider(provider, "Muse");
}

module.exports = { resolveRenderProvider, assertProvider };
