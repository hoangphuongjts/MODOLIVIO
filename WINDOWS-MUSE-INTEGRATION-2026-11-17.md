# MODOLIVIO — Annie Muse integration (local-only, no push)

Base: `feature/p3-windows-bridge-agent` commit `06265d1f70a505d89ce96cce59734287e9eb5058`.

## Uploaded files integrated

- `windows-app/p3/muse/museCdpEngine.js` — Muse chat DOM selectors, 5-minute manual session recovery, 10-minute scene wait, CDP implementation (not live-tested).
- `windows-app/p3/muse/museProvider.js` — provider.submit()/getTask() and Muse/Seedance router.
- `windows-app/p3/muse/museCookieStore.js` — Electron safeStorage-backed vault; not activated in CI.
- `windows-app/p3/muse/museSessionVault.js` — source vault from team.
- `windows-app/p3/muse/autoReloginEngine.js` — team source included but NOT wired or started; no automated password or OTP filling.
- `windows-app/p3/muse/electronMuseBrowserDriver.js` — team source included but NOT invoked by runtime in this integration.
- `windows-app/muse-engine/python/faceLockVerifier.py` — real YuNet/SFace Python verifier code.
- `windows-app/muse-engine/python/test_faceLockVerifier.py` — Annie's six test cases.

## Connections

- `main.js` supports `MODOLIVIO_MUSE_ENGINE=1` and loads a protected vault. Without secure storage or `MODOLIVIO_MUSE_ALLOWED_PROFILE_ID` live Muse is disabled.
- `p3/provider-selector.js` routes `provider=muse` to uploaded MuseProvider, all other provider kinds to Seedance. Disabled Muse is blocked, never silently sent to Seedance.
- `p3/pipeline.js` forwards `profileId`, `jobId`, scene index, original product photo, character reference, and the actual Face Lock score to the renderer. MuseProvider rejects missing or <95% verifier result.
- Once MuseProvider returns `localFile`, pipeline copies the actual local MP4 path rather than requiring an HTTPS URL.
- VieNeu-TTS default is already `http://127.0.0.1:8123` in `main.js` and `p3/providers.js`.

## Prerequisites and current blockers

- Baseline handoff is an overlay; `windows-app/server.js`, `bridge.js`, `handlers.js`, `renderer/` and other full-app sources are not present in this snapshot. This is not a deployable EXE by itself.
- `npm install` must run on an internet-connected machine before `npm test`: the current sandbox cannot reach npm and lacks `ws`, `playwright`, and node typings. `windows-test.yml` now uses `npm install` (instead of stale npm lock `npm ci`) when it eventually runs.
- The actual OpenCV Zoo ONNX files are not included. Run `python ci/download-face-models.py` from `windows-app` with internet before Face Lock tests. The downloader refuses short Git LFS pointers and unexpected sizes. Files remain untracked by Git.
- `test_faceLockVerifier.py` skips two image-to-image assertions if Annie's reference image paths are absent. The CI gate now treats skipped cases as BLOCKED; never report 6/6 in that case.
- The Electron manual login profile and the separate managed Chrome CDP context are not proven to share an authenticated session. No real Muse job was attempted, no account cookies/proxy settings were imported, and no real Face Lock model executed in this sandbox.
- CI never logs in to Muse. This commit is local-only. No remote push, releases or paid actions.
