# ADR — Windows packaged Electron UI smoke: renderer capture + trusted mouse input

- Date: 2026-11-17
- Scope: `feature/p3-windows-bridge-agent`, no `main`, production or Muse sign-in
- Evidence at baseline: Run #43991425937 SUCCESS; actual `MODOLIVIO-Windows-UI-QA-5.zip` contains **one** image `main-window.png` (1008x655) captured by packaged Electron; no UI click event/three independent captures. User reports black PowerShell console in their three OS-based screenshots; those three captures are not substantiated by the ZIP.

## Fatal risks, reviewed through three lenses

| Root cause / future risk | Builder | Alternative researcher | Risk challenger | Check |
| --- | --- | --- | --- | --- |
| OS desktop capture targets PowerShell / wrong desktop | capture BrowserWindow webContents | Playwright Electron screenshot or window handle screenshot | no evidence screenshot belongs to EXE | Electron report includes renderer URL, window handle, PID |
| Portable launcher vs extracted Electron process | watch MODOLIVIO PIDs | attach CDP to packaged child | launcher exit 0 alone meaningless | process-observation.json and report |
| App not painted yet / blank image | poll React root and body text | wait for navigation readiness | a console image has nonzero PNG bytes | image brightness, colors, min dimensions, document title, root |
| Click not delivered | send `webContents.sendInputEvent` mouseMove/down/up | Playwright Electron locator.click | JS element.click is not equivalent to user input | trusted `click` captured by renderer, explicit target label |
| UI buttons can be selected by default | log actual click even if state same | compare before/after state | screenshot difference not automatically guaranteed | preserve names and snapshots; do not claim three different pages if same |
| Renderer or startup errors disappear | dump report, stderr/stdout, process observations | Playwright console / pageerror | silent electron crash hidden by shell | FAIL if process, native window, trusted clicks, PNG or errors fail |
| CI packaging could expose credentials | disable Muse, isolated user-data in RUNNER_TEMP | fake profile | artifacts might contain cookies | upload PNG, scrubbed report, process log only; no user profile |

## Decision

Run **the EXE that electron-builder built** with `--smoke-test`, use its own Electron `BrowserWindow.webContents.capturePage()` for three separate PNGs and native `sendInputEvent` mouse clicks for `Làm nhanh` and `Tổng quan`, and record evidence in a portable-only JSON report. This eliminates wrong-desktop console captures. No screenshots are rendered or doctored from reference images.

Workflow `packagedui` must fail closed if any stage fails. Upload UI artifact **always** for diagnosis, but the overall CI summary must report failure. No PR or `main` changes. Existing JS/TS, Face Lock and build gates remain in force.

## Revisit triggers

- If renderer cannot receive trusted native input in hosted runner: use Playwright Electron on Windows VM as fallback, never replace with fabricated screenshots.
- If UI requires authentication for a button: record BLOCKED; never put real Muse sessions/cookies in CI.
- If the React menu is initially selected, identical screenshots are permissible only with explicit trusted-click evidence and are not represented as three distinct pages.
- Commercial release requires code signing, accessibility, privacy and live-device checks; staging screenshots alone are insufficient.