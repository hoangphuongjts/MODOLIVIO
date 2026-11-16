# MODOLIVIO Windows Bridge Agent (P3)

## Current version and scope

The Windows package version for this work is **1.3.0** (`1.3.0-win1` in Electron IPC/About). The background agent binds only to `127.0.0.1`, trying ports 19740 through 19749 in order. It does not bind 18638 or 18650. Electron keeps it alive in the tray after the main window closes.

The bridge exposes REST endpoints under `/v1` and an authenticated WebSocket at the same local origin. It uses exact configured origins, a loopback-only remote address, a Host header matching the selected port, an expiring one-hour access token, rotating refresh token, a one-time pairing code, and per-job `Idempotency-Key`. It uses Electron's bundled Node `node:sqlite` module (no external native addon), with WAL and FULL synchronous mode. One worker processes jobs sequentially. A cache sweep removes intermediate files older than seven days; final videos are written to the persistent `exports` directory.

## Extension setup

Load `windows-app/extension` as an unpacked Manifest V3 extension. In the process environment that launches MODOLIVIO, set `MODOLIVIO_BRIDGE_ALLOWED_ORIGINS` to a comma-separated exact origin allowlist that includes the extension's actual `chrome-extension://<extension-id>` origin. Restart MODOLIVIO, open its tray menu, show the one-time pairing code, then enter that code in the extension popup. The extension only reads product title and Open Graph image URL from the current Shopee/TikTok Shop page; it does not read cookies or automate sign-in/CAPTCHA.

## Render settings

Set `BYTEPLUS_ARK_API_KEY` outside source code to enable Seedance. The default model is `dreamina-seedance-2-5-260628`. `MODOLIVIO_VIENEU_URL` selects the loopback local TTS server (default `http://127.0.0.1:8000`); `FFMPEG_PATH` selects FFmpeg (default `ffmpeg` in PATH). No API call is made without the BytePlus key.

Cloud is the default render route. `MODOLIVIO_LOCAL_OFFLOAD=1` can select a local route only for tasks the caller marks lightweight, while heartbeat is fresh and free disk is at least 2 GiB. A heartbeat older than 15 seconds or disk below 2 GiB routes to cloud. This Windows agent currently reports routing policy but does not implement a local rendering backend.

## Hard gates and verified limits

Jobs require 1–20 scenes, exactly ten seconds each, HTTPS source product image URLs, and no overlay objects. Numeric price patterns in spoken dialogue/captions are rejected. Both Face Lock and product identity verifiers are intentionally deny-by-default: no trusted verifier is integrated in this checkout, so scene jobs cannot pass these gates yet. Numeric scores or booleans supplied by a renderer/client are not treated as proof. Product identity in generated output is not computer-vision verified.

The Seedance request adapter and status polling use the official task create/get API shape. Rendering requires live credentials, a real Seedance task, local TTS, and FFmpeg. Do not claim a completed MP4 from unit mocks. The workflow stores scene task IDs for crash recovery and never submits an already-recorded task twice. API key usage can incur charges; live generation must be separately authorized and was not run during development.

## API and operational checks

- `POST /v1/auth/pair`: one-time code exchange for access + refresh tokens.
- `POST /v1/auth/refresh`: rotates the refresh token silently.
- `GET /v1/bridge/status`: selected port, queue summary, route and disk/heartbeat state.
- `POST /v1/bridge/heartbeat`: resets the local heartbeat.
- `POST /v1/products/import`: stores a URL-validated Shopee/TikTok Shop DOM snapshot.
- `GET /v1/jobs`, `POST /v1/jobs`: persistent job queue; writes require a bearer token and idempotency key.
- WebSocket: clients authenticate with a first JSON message `{ "token": "..." }`.

The extension's exact origin must be present in the allowlist; do not use `*`. The loopback URL itself is not an authentication boundary.

## Session safety and account protection

The app can open a visible, persistent Muse sign-in window in a per-profile Chromium partition named `persist:mo-muse-<profileId>`. Set `MODOLIVIO_MUSE_LOGIN_URL` and the exact HTTPS origin in `MODOLIVIO_MUSE_ALLOWED_ORIGINS`; the app does not guess a Muse endpoint. Authentication indicators (401/403, OIDC/login/CAPTCHA redirects and visible page text) pause and offer a visible user sign-in page. The monitor checks the visible page every 15 minutes. Password entry and human verification remain user-controlled. `MuseSessionVault` uses AES-256-GCM for user-authorized access/refresh tokens and wraps its data key with Electron `safeStorage`; it rejects weak/unavailable storage backends and does not accept browser cookies, passwords, or extension-extracted HttpOnly cookies. No official Muse OAuth token source/callback has been integrated, so the vault is currently a tested storage component and the sign-in page uses Chromium's own persistent profile storage.

Safe Mode is on by default. Durable per-profile limits are 3 jobs/hour, 15/day, and 15/week. Signals such as 429/CAPTCHA, OIDC redirect, repeated rejected prompts, unusually slow render/thread creation, repeated session refresh, suspected account disablement, or early credit exhaustion trip a persistent circuit breaker, write a local JSONL alert, stop that profile, and route status to the cloud fallback. `SUSPECT_DIE` triggers a two-hour cooldown; clearing a tripped circuit requires an explicit user action. The app does not rotate accounts/IPs or imitate human behavior to avoid platform detection. No Muse CDP/Playwright UI automation, patched browser, anti-detection driver, or HttpOnly-cookie extraction is included. No verified official Muse rendering API exists in this checkout, so live Muse rendering remains unimplemented and unverified.
