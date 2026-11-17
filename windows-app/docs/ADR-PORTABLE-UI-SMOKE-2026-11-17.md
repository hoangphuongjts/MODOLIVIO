# ADR — Windows portable EXE UI smoke on GitHub Actions

**Scope:** `feature/p3-windows-bridge-agent` only. **Decision:** test the actual `dist-win/MODOLIVIO-Windows-1.3.0-portable.exe` through Electron's existing `--smoke-test` (native `webContents.capturePage`), and upload real PNGs and diagnostics.

## Critical failure modes reviewed before implementation

1. GitHub-hosted desktop may not expose an interactive session; a real Electron renderer capture is preferred over a synthetic/full-desktop placeholder.
2. The NSIS portable launcher extracts and starts an Electron child; successful launcher exit alone is insufficient. Observe launcher and extracted Electron process separately.
3. A renderer may load a blank/error view; require native BrowserWindow state, a populated frontend root/body and non-uniform PNG pixels.
4. Screenshots might contain private data. Use a fresh disposable runner and disable Muse live, Muse profile, credential imports and external sign-in; never upload a user profile.
5. Rendered pages behind MODOLIVIO sign-in are not proof of usable functionality. Take the initial reachable screen only; "Tổng quan"/"Làm nhanh" remain **chờ kiểm chứng thật** if gated behind a login.
6. A failed UI smoke can be masked by `continue-on-error`; add the real `steps.packagedui.outcome` and `steps.uiartifact.outcome` to the terminal fail-closed QA gate.

## Options and cross-check (three review perspectives)

- **Builder:** reuse current `--smoke-test` native capture; minimal app changes confined to smoke-only diagnostics.
- **Alternative researcher:** Playwright Electron/CDP or desktop capture may enable navigation, but adds dependencies and can confuse an offscreen renderer with a signed-in desktop. Not used for this smoke.
- **Risk reviewer:** require native window/process evidence, inspect image pixels and visible DOM, save failures as artifacts. If the runner cannot render UI, mark FAIL/BLOCKED; do not create a fake screenshot.

No independently called Annie/Gemini agents participated in this ADR; these are three analytical review perspectives, not simulated agent approvals.

## Acceptance and rollback

- Existing 13 Windows CI gates must remain successful.
- Launch **packaged portable EXE**, not `electron .` or a static renderer URL.
- Observe running parent and Electron child; require `BrowserWindow` visible and native handle.
- Validate PNG >= 900x500, varied pixels, document title MODOLIVIO, nonempty app root/body and no recorded renderer errors.
- Upload `ui-smoke/main-window.png`, process observation, renderer state and startup logs as QA artifacts; include evidence alongside EXE QA ZIP too.
- No Muse account/session, private photos, top-up, production publish or merge to main.
- Revert this single feature-only commit to return to baseline CI workflow. Screenshots are disposable (7-day retention).

## Two scenarios

**Current free CI:** GitHub-hosted Windows runner, no account login, screenshot of currently reachable app screen; CI QA only. Trigger: push to feature branch. Native packaged UI smoke can PASS while deeper app flows remain **chờ kiểm chứng thật**.

**Future commercial operation:** sign binaries, test installer upgrades, account-based navigation in a secured dedicated Windows VM with explicit consent and synthetic users, accessibility/UX and release telemetry. Trigger: proposed production release/commercial pilot; requires privacy/security and finance approval, not enabled by this change.