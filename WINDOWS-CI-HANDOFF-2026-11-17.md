# MODOLIVIO — Windows CI / local-only integration handoff (17/11/2026)

## Scope and provenance

- SOURCE: verified `MODOLIVIO-Bridge-Agent-feature-p3-windows-bridge-agent.zip` handoff ZIP, exported from `feature/p3-windows-bridge-agent` at stated HEAD `cf5870cd80a1f4a2cc0377b2040fce27e4d92439` (this ZIP does not include the original Git repository history).
- Local repository was initialized from that ZIP snapshot and existing ChatGPT 17-Nov patch; local history is **not** the upstream commit DAG. It is intentionally not named `main` and **not pushed**.
- GitHub remote public repository has `main` only at last verified check; do not claim this commit is remotely deployed.
- Annie's newer `museCdpEngine.js`, `museProvider.js`, `faceLockVerifier.py`, and ONNX models are NOT present in that handoff ZIP. These must be copied from Annie's authoritative source before the app is called Muse-integrated.
- ZIP is a **delta** relative to upstream `main`, not a standalone buildable repo. Missing `windows-app/server.js`, `bridge.js`, `handlers.js`, renderer assets, electron-builder configuration. Must merge these into a complete checkout before Windows CI can pass or EXE can build.

## Included changes

1. `.github/workflows/windows-test.yml`: manual, Windows-latest only; Node 20 installed as requested, Node 24 used for runtime because `node:sqlite` is absent from Node 20; Python 3.12; Chrome install/verification; `npm ci`, syntax, full JS tests, typecheck, REAL Face Lock check, Bridge 19740–19749 mock-provider HTTP smoke, isolated Chrome CDP 19750–19759 smoke, electron-builder EXE, SHA-256 and artifact labeled `UNVERIFIED` until all gates succeed.
2. `windows-app/ci/smoke-bridge.js`: uses random local pairing code and configured Origin, checks real local HTTP status, one worker, and rejection of untrusted Origin. **No Muse login or provider call.**
3. `windows-app/ci/smoke-cdp.ps1`: launches isolated temporary Chrome headless on `about:blank` and tests real CDP endpoint without account cookies.
4. `windows-app/ci/verify-face-lock.py`: requires Annie's actual Python script, both YuNet+SFace ONNX models and at least six real Python tests. It **fails closed** if sources are absent.
5. `windows-app/p3/provider-selector.js` and main app integration: the string `muse` must resolve to the real Muse provider or throw `MUSE_SOURCE_MISSING`; any other provider value uses the existing Seedance adapter. Never silently send Muse jobs to Seedance. API contract to actual Annie engine remains **UNVERIFIED**.
6. Inherited ChatGPT 17-Nov patch: Face Lock preflight before queue; product DOM reader; read-only CDP inspection script; TTS default 8123; mock unit tests.

## Known blockers

- **GitHub Actions run URL**: BLOCKED. User explicitly forbade push, and `.github/workflows/windows-test.yml` does not yet exist on GitHub's default branch. `workflow_dispatch` cannot run until the file is committed and published to GitHub by a separately authorized future operation.
- **Windows real CI outcomes / EXE artifact URL**: NOT TESTED because the workflow has not run on GitHub. Do not invent a run or artifact link.
- **Actual Muse provider / CDP DOM selector / real render**: NOT TESTED. No Annie source, browser session, or model assets in the accessible ZIP. CI deliberately does not log in to muse.ai.
- **Face Lock ONNX**: BLOCKED missing Annie verifier/model files in accessible source. Existing unit tests are mocked and do not replace real inference.
- **Local npm ci**: BLOCKED (network unavailable; offline cache is missing transitive dependencies). The `ws` dependency is not installed, so full local JS suite cannot pass. Only tests independent of `ws` can be run locally.
- **Windows EXE build**: BLOCKED locally (Linux environment + missing upstream base files/dependencies).

## To finish after source sync (separate future operation)

1. Restore complete Windows app `main` baseline without overwriting Bridge Agent changes. Apply local feature commit against that baseline in a dedicated worktree; inspect conflicts.
2. Synchronize Annie's actual `museCdpEngine.js`, `museProvider.js`, `faceLockVerifier.py` and models from her authoritative workspace. Never substitute fabricated code or commit private face images / secrets to public repo. Verify provider `submit/getTask` compatibility and turn on `MODOLIVIO_RENDER_PROVIDER=muse` only after it passes.
3. Run `npm ci`, `npm test`, `npm run typecheck`, `python ci/verify-face-lock.py`, then full Windows VM workflow. Verify each step and SHA independently.
4. Only with a separate instruction that changes the current `NO PUSH` constraint may any commit/workflow be published to GitHub. The Windows runner is not accessible through this offline local bundle.

## Security boundaries

Manual workflow only, `permissions: contents: read`, no external Muse login, no cookies/token writes, no upgrade/top-up, no proxy or extension toggles, CDP temporary localhost-only on GitHub runner, no production release.
