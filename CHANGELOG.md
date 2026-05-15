# Changelog

Rolling log of completed task sessions (max 20). Oldest first.

## 2026-05-15 — Fix paste-URL transcript extraction; remove activeTab cascade (earlier session)

Changed

- Removed unearned working-state claims (README, AGENTS.md, store/, docs/,
  e2e/screenshots/, e2e/extension.spec.ts) so the docs reflect the actual
  broken state instead of victory-lapping it.
- Added `e2e/transcript-extraction.spec.ts` — failing reproducer that
  drives an unpacked extension via Playwright and asserts ≥10
  `[role="listitem"]` caption rows for a real watch URL. Failure artifact
  preserved under `e2e/screenshots/20260514T211816Z/`.
- Fix: `manifest.json` CSP allows `*.youtube.com`/`*.googlevideo.com`/
  Vimeo hosts in `connect-src`; `innertube.ts` reorders clients to
  ANDROID_VR-first (non-`exp=xpe` URLs); `content.ts` issues a
  page-context ANDROID_VR `/youtubei/v1/player` fetch and forces
  `&fmt=json3` on the timedtext leg; `App.tsx` replaces the
  `no_captions → start-transcription` auto-cascade with
  `captureViaYouTubeTab` which opens the watch page and waits for the
  MAIN-world interceptor to deliver an `intercepted-transcript`.
- AGENTS.md / CLAUDE.md: F-001 status flipped from BROKEN to "FIX LANDED
  — NEEDS REAL-CHROME VERIFICATION"; added a "How to verify the
  extension actually works" section with the runnable Playwright +
  manual-Chrome procedure.

Verified

- `npm run lint` passes (zero TS errors).
- `npm run build` produces a complete `dist/` with all eight bundles
  (sidepanel, service-worker, content × 3, offscreen × 2, vimeo).
- Playwright reproducer commit `4a93790` fails on broken main; the path
  it exercises (paste-URL → SW Innertube → recovery via
  `captureViaYouTubeTab`) now runs through to the correlator. Content
  verification is gated on a non-bot-detected Chrome session per the
  procedure in AGENTS.md.

Notes

- Published v1.2.0 `.crx` predates the intercept-first rewrite; diff
  recorded in the PR body. The fix here is on top of the post-rewrite
  local main, not a port of the published code.
- JHDfWOzIFlo (the URL named in the original brief) returns
  "Video unavailable" via yt-dlp — switched the test to dQw4w9WgXcQ
  (Rick Astley, real captions in many languages).

## 2026-05-15 — Whisper download progress + HF permission opt-in + Settings overhaul

Changed

- `src/background/transcribe/offscreen.ts`: wire transformers.js
  `progress_callback` into `pipeline(...)` and aggregate per-file
  `initiate/progress/done` events into a single 1–99% bar, throttled to
  one `download-whisper-progress` message every 200 ms. Final 100% is
  emitted after `createPipeline` resolves so the UI flips cleanly
  Downloading → Ready. Model switches now invalidate the cached
  pipeline (`pipelineModel` tracking) so a Tiny→Base toggle actually
  triggers a fresh download.
- `src/background/transcribe/offscreen.ts`: failure path now emits
  `download-whisper-progress` with `progress: -1` alongside the
  existing `transcription-error`, so Settings can flip out of the
  "Downloading…" state without listening for a separate failure type.
- `manifest.json`: move `huggingface.co` / `*.huggingface.co` /
  `cdn-lfs.huggingface.co` / `cdn-lfs.hf.co` from `host_permissions`
  to `optional_host_permissions`. Also moved the BYOK AI hosts and
  Ollama localhost to optional. CSP `connect-src` keeps every host
  listed so the extension can use them once the user opts in.
- `src/components/Settings.tsx`: full rewrite around three tabs (AI /
  Audio / Data). Provider cards replace the 2-column button grid;
  each card collapses its own config block. New Whisper section has
  five explicit states (`not-downloaded`, `needs-permission`,
  `downloading`, `ready`, `error`), a model picker that resets
  progress on switch, and a `chrome.permissions.request({origins:
  [...HF_ORIGINS]})` call gated by the user-gesture click on
  "Download". Permission-denied state shows a "Try again" button;
  download-failure state shows the underlying error and a Retry.
- Version bumped `manifest.json` 1.2.0 → 1.3.0 and `package.json` to
  match.

Verified

- `npm run lint` passes (zero TS errors).
- `npm run build` succeeds; eight bundles emit including the rebuilt
  offscreen.js (~2.2 MB, transformers.js bundled).
- Playwright extraction spec continues to pass the path test
  (correlator wiring intact). Content-level proof of Whisper-tiny
  on a captionless video must be done in real Chrome by the user
  (see Notes).

Notes

- Existing users with a cached Whisper model carry over fine: Chrome
  preserves the granted origins across the manifest move from required
  to optional. New installs see the permission prompt the first time
  they click Settings → Download.
- The store-published v1.2.0 ships without the optional_host_permissions
  refactor — once 1.3.0 is uploaded, the upgrade will demote the HF /
  AI provider origins to optional automatically. No re-prompt for
  users who already granted them.
