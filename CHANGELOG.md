# Changelog

Rolling log of completed task sessions (max 20). Oldest first.

## 2026-05-15 — Fix paste-URL transcript extraction; remove activeTab cascade (earlier session)

Changed

- Removed unearned working-state claims (README, AGENTS.md, store/, docs/,
  e2e/extension.spec.ts) so the docs reflect the actual
  broken state instead of victory-lapping it.
- Added `e2e/transcript-extraction.spec.ts` — failing reproducer that
  drives an unpacked extension via Playwright and asserts ≥10
  `[role="listitem"]` caption rows for a real watch URL.
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
  to `optional_host_permissions`. CSP `connect-src` keeps model-download
  hosts listed so the extension can use them once the user opts in.
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
  refactor — once 1.3.0 is uploaded, the upgrade will demote the model-download
  origins to optional automatically. No re-prompt for users who already granted them.

## 2026-05-23 — Cut to 3 AI buttons + Chat; fix the four reported bugs

Changed

- Cut 15 AI prompts (sentiment, topics, mindmap, quotes, quiz,
  flashcards, studyGuide, studyNotes, qaGenerate, blogOutline,
  socialPosts, seoKeywords, entities, chapterSummary, actionItems)
  and the "More" disclosure. Final surface: Summary / Key points /
  Q&A buttons plus the bottom Ask box. AiPanel.tsx lost 437 lines net.
- Delete `src/components/BilingualView.tsx` (227 lines, never wired).
- Shrink `AiFeature` union 18 → 3 in `src/types/transcript.ts`.
- Bug fix — "Input is too large" on long transcripts: Chrome AI now
  uses `session.measureInputUsage` + a binary head+tail trim in
  `chrome-ai.ts:fitToQuota` so the actual quota of the user's Gemini
  Nano build drives sizing. PromptTemplate signature reshaped from
  `user(t)` to `instructions` so the trimmable transcript lives
  separately from the fixed instructions.
- Bug fix — Q&A markdown literal `**Q:**`: AiPanel.tsx now renders
  results through `react-markdown` + `remark-gfm`. Custom component
  renderers post-process plain text and inline-code timestamps into
  clickable `<TimestampButton/>` instances.
- Bug fix — timestamp click did nothing: `service-worker.ts` adds a
  `seek-to` case that forwards via `chrome.tabs.sendMessage` to the
  broadcasting tab. `correlator.ts` tracks `lastBroadcastTabId` so
  the SW knows which tab to forward to.
- Bug fix — feature lockdown / no cancel: AbortController wired into
  `runFeature`. Switching feature aborts the prior request, a Stop
  link sits next to the spinner, and a transcript-change cleanup
  effect aborts on video navigation. AbortError is swallowed so it
  doesn't show as a red error.
- Add `react-markdown@^9` and `remark-gfm@^4` to deps. Pure-JS, no
  network calls. ~40 KB gzipped; only loads when AiPanel mounts
  (already lazy-loaded from App.tsx).
- AGENTS.md / CLAUDE.md: parity table marks removed features as
  REMOVED 2026-05-23, new EXTRA-007 (cancel) and EXTRA-008 (timestamp
  click) rows. AI prompt inventory replaced by the 4-row truth + a
  "Provider sizing rules" section.

Verified

- `npm run lint` passes (zero TS errors).
- `npm run build` succeeds; all eight bundles emit. AiPanel chunk
  grew to 162 KB raw (~40 KB gzipped) from the markdown deps; lazy-
  loaded so it only hits the wire on first AI-button click.
- Real-Chrome content verification (transcript fetch + 4 AI features +
  timestamp click + cancel mid-request, on the Yu-Gi-Oh "Top 25 Rares"
  case that originally triggered "Input is too large") must be done
  by the user per the procedure in AGENTS.md "How to verify the
  extension actually works".

Notes

- The branch `fix/innertube-timeouts-po-token-retry` is net -1806/+237
  vs main before this pass, and the cut adds ~450 more lines deleted.
  The plan is to merge this branch to main and delete it, ending the
  floating-branch state.
- Post-review pass: CodeRabbit autofix extracted a shared
  `fetchWithPoTokenRetryCore` helper in `innertube.ts` (both
  `fetchTrackSegments` and `fetchSegmentsWithPoTokenRetry` reduce to
  one-line delegations; `fetchTrackSegments` gains the original
  `ApiError` preservation it previously lacked). The Whisper status
  listener tightened to strict model-equality (`msg.model !== model`)
  so undefined `msg.model` no longer slips through.
- Seven other reviewer findings (six speculative unit tests, plus
  README dev-workflow expansion, zip preflight, version-consistency
  check, numeric-constructor backwards compat for `BatchProcessor`,
  and a request-id cancel protocol for batches) were verified against
  current code and skipped as out of scope for this stabilization
  pass.

## 2026-07-11 — v1.4.0: version bump for Chrome Web Store update

Changed

- Bumped `manifest.json` + `package.json` version 1.3.1 → 1.4.0. The
  store build uploaded 2026-06-03 was also labeled 1.3.1 but predates
  the AI-panel simplification, provider-layer removal, TypeScript 6,
  and dependency-major updates (incl. @huggingface/transformers v4)
  that landed on main afterwards — this bump disambiguates the two.

Verified

- `npm run lint` zero errors; manifest unit tests 3/3 pass;
  `npm run zip` produced `yt-transcript-chrome.zip` (6.7 MB, up from
  ~5.7 MB at 1.3.1 — transformers v4).
- Real-Chrome content verification per AGENTS.md "How to verify the
  extension actually works" is required before submitting this build
  for store review.

## 2026-07-16 — v1.5.0: go generic + drag-and-drop file transcription

Context

- A trademark Content Infringement Complaint (2026-07-16) against the
  Edge listing forced removal of platform names from the extension's
  branding. The Chrome listing shares the exposure. Response: every
  user-facing surface is now platform-generic, and the product widens
  from "extract transcripts of site X" to "turn any video into text."

Changed

- Renamed extension to **Transcript Extractor** (`manifest.json` name,
  description, action title; side-panel `<title>`; wordmark `yt·tx` →
  `t·x`). UI strings, error copy, and the legal page are now
  platform-neutral; the legal disclaimer became a generic
  "Trademarks & Affiliation" section. PRIVACY.md renamed + covers
  dropped files. Version 1.4.0 → 1.5.0 in lockstep.
- NEW (EXTRA-009): drag-and-drop / file-picker transcription. Drop any
  video or audio file anywhere in the panel; `App.tsx` mints a `blob:`
  URL, SW forwards `transcribe-file` → offscreen
  `offscreen-transcribe-file`, `decodeToMono16k` (OfflineAudioContext)
  demuxes/resamples to 16 kHz mono, and the existing chunked Whisper
  loop streams segments via the unchanged `transcription-*` message
  contract. Model download shows as the first 20% of the progress bar;
  blob URL revoked on complete/error/stop; `file-*` synthetic ids are
  excluded from watch-page error recovery.

Verified

- `npm run lint` zero errors; `npm run build` green (8 bundles);
  manifest unit tests 3/3 pass.
- Real-Chrome verification of the drop flow (and the standing F-001
  sign-off) still required before store submission, per AGENTS.md.
