"use strict";

/** Cloud rendering is always the default; local work is opt-in and lightweight only. */
function chooseRenderRoute({ lightweight = false, heartbeatAgeMs = 0, diskFreeBytes = Infinity, localOffloadEnabled = false }) {
  if (heartbeatAgeMs > 15_000 || diskFreeBytes < 2 * 1024 ** 3) return { route: "cloud", reason: "cloud-fallback-condition" };
  if (localOffloadEnabled && lightweight) return { route: "local-lightweight", reason: "explicit-lightweight-offload" };
  return { route: "cloud", reason: "cloud-default" };
}

module.exports = { chooseRenderRoute };
