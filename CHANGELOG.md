# Changelog

Rolling log of completed task sessions (max 20). Oldest first.

## 2026-05-15 — Fix paste-URL transcript extraction; remove activeTab cascade

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
