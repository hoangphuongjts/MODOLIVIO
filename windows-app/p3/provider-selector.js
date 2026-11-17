"use strict";

// Resolve the real uploaded MuseProvider; never silently reroute Muse to Seedance.
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
  const { MuseProvider } = require("./muse/museProvider.js");
  if (!options.dataDir) throw new Error("MuseProvider requires explicit Bridge dataDir (fail closed)");
  return assertProvider(new MuseProvider(options), "Muse");
}

/** Explicit optional providers for checkJs on Windows; keep fail-closed behavior unchanged.
 * @param {{enableMuse?: boolean, defaultProvider?: string, seedanceProvider?: any, museProvider?: any, dataDir?: string, [key: string]: any}} [options]
 */
function createRenderRouter({ enableMuse = false, defaultProvider = "seedance", seedanceProvider, museProvider, ...museOptions } = {}) {
  const seedance = assertProvider(seedanceProvider || new SeedanceProvider(), "Seedance");
  if (defaultProvider === "muse" && !enableMuse) throw new Error("Muse requested but MODOLIVIO_MUSE_ENGINE is not enabled");
  // Keep offline/CI tests independent of Playwright when Muse is disabled.
  if (!enableMuse) {
    return {
      async submit(payload) {
        if (payload?.provider === "muse") throw new Error("Muse engine disabled; job blocked, never sent to Seedance");
        return seedance.submit(payload);
      },
      async getTask(taskId) {
        if (String(taskId).startsWith("muse_")) throw new Error("Muse engine disabled; Muse task cannot be queried as Seedance");
        return seedance.getTask(taskId);
      },
    };
  }
  const { createProviderRouter } = require("./muse/museProvider.js");
  const muse = resolveRenderProvider("muse", { museProvider, ...museOptions });
  const router = createProviderRouter({ seedance, muse });
  return {
    muse,
    async submit(payload) { return router.submit({ ...payload, provider: payload?.provider || defaultProvider }); },
    getTask(taskId) { return router.getTask(taskId); },
    setBridgePort(port) { muse.bridgePort = port; },
  };
}

module.exports = { resolveRenderProvider, createRenderRouter, assertProvider };
