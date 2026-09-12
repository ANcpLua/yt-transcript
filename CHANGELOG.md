# Changelog

## 3.1.0 — 2026-09-12

- Added a Firefox build with sidebar support, so the extension ships from one
  source to Chrome, Edge, and Firefox.
- Replaced the logo: Video Transcript no longer shares savemedia's artwork. The
  download arrow is gone, which never described this extension and put it in the
  downloader category that stores treat differently.
- Transcription is now offered only when Chrome's on-device audio model is
  actually available. The panel previously checked that the `offscreen` and
  `tabCapture` APIs existed, which says nothing about the model, so the offer
  appeared on hardware that could not honor it and failed only after the user
  committed to it.
- Rewrote the store description. The previous one listed file formats as a bare
  run of acronyms, which the Chrome Web Store rejected as keyword spam.
- Replaced the privacy policy, which still described a network interceptor
  removed in 3.0.0 and a model download that no longer exists.
- The end-to-end fixture certificate is generated on first run instead of living
  in the repository, keeping a private key out of the source archive.

## 3.0.0 — 2026-07-23

- Replaced the static single-platform interceptor with user-invoked discovery
  across runtime `TextTrack` cues, `<track>` resources, bounded fetch/XHR
  candidates, `blob:`/`data:` tracks, HLS playlists, and DASH text
  representations.
- Added WebVTT, SRT, TTML/DFXP, ASS/SSA, SAMI, SBV, LRC, and timestamped JSON
  normalization with duplicate suppression and a 2 MiB text-body ceiling.
- Removed manifest-declared content scripts, permanent host access, the old
  interceptor/bridge, the duplicate service-worker caption fetch, and unused
  transcript-panel automation.
- Added exact-origin media-source permission prompts. Cross-origin caption
  text is fetched by the extension service worker so page CSP cannot block it.
- Added visible pasted-URL handoff, action-state badges, multiple selectable
  tracks, generic history URLs, and MV3 session restoration for native and
  adapter transcripts.
- Reworked live audio around 8-second windows, playback pause/mute suspension,
  end-of-media finalization, media-time timestamps, silence rejection, refusal
  filtering, and audible tab playback.
- Standardized Prompt API modality/language options and replaced stale
  architecture and privacy documentation.

Validation completed during implementation:

- strict TypeScript;
- 12 unit tests;
- production build;
- zero npm audit advisories;
- focused unpacked-extension coverage for paused cues, cross-origin WebVTT,
  Prompt API options, and the optional adapter.

Real-GPU Nano accuracy and the final full Playwright suite remain
pre-store-submission checks.
