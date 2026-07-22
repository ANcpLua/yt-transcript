# Transcript Extractor — Browser Extension (repo: yt-transcript)

> **Naming rule (2026-07-16, trademark complaint):** every user-facing
> surface — manifest name/description, UI strings, store listings, legal
> page — must stay platform-generic. No video-platform names in anything
> the user or a store reviewer sees. Internal identifiers, host
> permissions, and technical docs like this file may reference platform
> domains where technically necessary.

## Scope

Free MV3 Chrome side-panel extension: instant transcripts on YouTube (caption
extraction) plus universal on-device transcription of any other video or dropped
media file via Chrome's built-in AI (Gemini Nano audio input). Replaces
youtube-transcript.io with zero cost — everything they gate behind credits,
logins, or paid tiers, we do free, locally, no backend, and (as of 2.0.0) no
model download.

When you are asked to work on this project, you must read this entire file first. Do not skip sections.
Do not propose changes that violate the hard constraints. Do not ask clarifying questions when the answer
is in this file.

## Hard Constraints

- **ZERO COST.** No backend. No paid APIs. No accounts. No credits. No server. Extension only.
- **AI = Chrome built-in AI only.** No API keys, accounts, provider setup, backend proxy, paid AI service, or bundled ML runtime. Gemini Nano does everything: text (summary/Q&A/chat via the Prompt API) AND transcription (Prompt API **audio input**). As of 2.0.0 there is no Whisper / transformers.js. Transcription needs Chrome desktop 138+ with a >4 GB-VRAM GPU (audio input has no CPU fallback) and fails loud via an `availability()` probe when the hardware can't run it — captions still work for everyone.
- **No tracking.** No analytics, no cookies, no telemetry. Network tab must show zero requests to tracking domains.
- **No npm packages that phone home.** Audit every dependency.
- **Stack: React 19, Vite, Tailwind CSS 4, TypeScript strict.** No exceptions.
- **No `any` types.** Use `unknown` + type narrowing.
- **Extension-first.** This is a side panel, not a web page. Design for 400px width, not 1200px.

## Things to consider

- The transcript pipeline is **intercept-first**. The MAIN-world content script
  (`src/content/yt-interceptor.ts`) rides on YouTube's own `get_transcript` /
  `player` calls — read the "Transcript Extraction Architecture" section
  before touching any extraction code, and prefer fixing the parser
  (`src/lib/intercept/parseGetTranscript.ts`) over re-implementing the
  Innertube fetch chain. Innertube is the paste-URL fallback only.
- The Innertube API is undocumented and YouTube changes it without notice. The
  paste-URL fallback (`src/background/innertube.ts`) is one client only
  (`WEB_EMBEDDED_PLAYER`) plus a watch-page scrape — keep it slim.
- Side panel width is ~400px. Components designed for full-page layouts must
  be adapted.
- `TranscriptView.tsx` (~36KB / 695 lines) is still on the chunky side.
  `AiPanel.tsx` shrank in the 2026-05-23 cut (was ~20KB, now ~16KB)
  but added react-markdown rendering and AbortController. Split only if
  you're already modifying them and the change is non-trivial.
- Inline SVGs still appear in several components. Four files duplicate the
  same close-X glyph; consolidate when you touch icon code.
- Transcription (captionless videos + dropped files) runs in the offscreen
  document: `chrome.tabCapture` + `AudioWorkletNode` (live capture) or
  `OfflineAudioContext.decodeAudioData` (dropped file) → 16 kHz mono PCM →
  Chrome Prompt API **audio input** (`LanguageModel.create({expectedInputs:
  [{type:"audio"}]})` → per-window `clone()` → `prompt([{type:"audio", value:
  AudioBuffer}])`). No model download; Chrome manages Gemini Nano. Nano returns
  prose with no per-cue timestamps, so `Segment.start/duration` are synthesized
  from the 12 s chunk offset. See the Transcription Architecture section.

## Competitive Target

We replace youtube-transcript.io feature-for-feature. This is the parity table:

<feature_parity>

| ID | Their Feature | Their Tier | Our Status | Our Approach |
|----|---|---|---|---|
| F-001 | Single transcript extraction | Free (25/mo cap) | **DONE — NEEDS REAL-CHROME VERIFICATION** | Intercept-first MAIN-world fetch hook (`yt-interceptor.ts`) + paste-URL recovery that opens the watch page in a tab and waits for the correlator (`App.tsx:captureViaYouTubeTab`). Content script (`content.ts`) fires a page-context ANDROID_VR `/youtubei/v1/player` call so captionTrack URLs are not `exp=xpe`-gated. Playwright harness is bot-detected by YouTube — treat as a path-regression guard, not caption-content proof. |
| F-002 | Playlist bulk extraction | Plus ($9.99/mo) | **DONE** | `UrlInput.tsx` detects playlist URLs → `chrome.runtime.sendMessage({type:"fetch-playlist"})` → video selection panel → batch queue |
| F-003 | CSV bulk upload | Plus | **DONE** | `UrlInput.tsx` file input accepts `.csv/.txt`, parses video IDs via `parseVideoId`, feeds into `onSubmitBatch` |
| F-004 | Channel ID finder + transcripts | Plus/Pro | **DONE** | `UrlInput.tsx` detects channel URLs → `chrome.runtime.sendMessage({type:"fetch-channel"})` → selection panel → batch |
| F-005 | Transcript history | 3d free / 90d paid / unlimited Pro | **DONE** | `lib/storage/history.ts` + `History.tsx` modal |
| F-006 | AI Summary | Login + credits | **DONE** | `promptTemplates.summary` + Summary button. Chrome AI uses `session.measureInputUsage` for adaptive truncation (`chrome-ai.ts:fitToQuota`). |
| F-007 | AI Sentiment analysis | Login + credits | **REMOVED 2026-05-23** | Cut in the feature-trim pass. Users who want sentiment can ask via the Chat box. |
| F-008 | AI Topic extraction / hashtags | Login + credits | **REMOVED 2026-05-23** | Cut. Ask via Chat. |
| F-009 | AI Q&A from transcript | Login + credits | **DONE** | `promptTemplates.qaExtract` + Q&A button. Output now renders as markdown via `react-markdown` so `**Q:**` no longer shows literally. |
| F-010 | Chat with transcript | Beta/paid | **DONE** | `AiPanel.tsx` Ask box. Chrome AI path puts transcript in `trimmableContent` so the session quota is measured, not blown. |
| F-011 | Summarize transcript | Credits | **DONE** | Folded into F-006 (Summary). |
| F-012 | Mindmap | Credits | **REMOVED 2026-05-23** | Cut. The panel never rendered mermaid visually; output was raw code. |
| F-013 | Key Quotes | Credits | **REMOVED 2026-05-23** | Cut. Low discoverability ("no idea what quotes is"); ask via Chat. |
| F-014 | Study Guide | Credits | **REMOVED 2026-05-23** | Cut, redundant with F-015/F-016. |
| F-015 | Q&A Generation | Credits | **REMOVED 2026-05-23** | Cut, overlapped with F-009. |
| F-016 | Quiz | Credits | **REMOVED 2026-05-23** | Cut, study-app feature not central to a transcript extractor. |
| F-017 | Flash Cards | Credits | **REMOVED 2026-05-23** | Cut, same rationale as F-016. |
| F-018 | Highlights | Credits | **DONE** | Per-segment highlight/note icons in `TranscriptView.tsx`, IndexedDB persistence via `App.tsx`, "Highlights" copy button in `ExportBar.tsx` |
| EXTRA-001 | Filler word removal | They don't have this | **DONE** | Toggle in `TranscriptView.tsx`, applies `removeFillersFromSegments` in `displaySegments` memo, exports respect toggle via `ExportBar.tsx` |
| EXTRA-002 | Speaker labels | They don't have this | **REMOVED 2026-07-22** | `detectSpeakers.ts` existed but was never imported by any component — dead code; helper and this claim removed in the cleanup pass. |
| EXTRA-003 | Chapter extraction | They don't have this | **DONE** | `parseChapters.ts` parses description timestamps, collapsible dividers in `TranscriptView.tsx`, chapter headings in Markdown export |
| EXTRA-004 | Bilingual side-by-side | They don't have this | **REMOVED 2026-05-23** | `BilingualView.tsx` deleted; never wired to UI. |
| EXTRA-005 | 6 export formats | They only have copy | **DONE** | TXT, SRT, VTT, JSON, CSV, Markdown + Notion + Obsidian variants |
| EXTRA-006 | Offline | They don't have this | **DONE** | Works without internet once fetched |
| EXTRA-007 | Cancel mid-AI-request | They don't have this | **DONE** | AbortController in `AiPanel.tsx`: switching feature aborts the prior request, "Stop" link next to the spinner, new transcript navigation aborts via cleanup effect. |
| EXTRA-008 | Click-timestamp scrubs player | They have this | **DONE** | `AiPanel.tsx` post-processes `MM:SS` in markdown text + inline code into clickable buttons; SW forwards `seek-to` to the broadcasting tab via `chrome.tabs.sendMessage`. |
| EXTRA-009 | Drag-and-drop any-file transcription | They don't have this | **DONE (2.0.0) — NEEDS REAL-CHROME VERIFICATION (GPU)** | Drop any video/audio file anywhere in the panel (`App.tsx` drop overlay) or use the landing-screen picker (`UrlInput.tsx`). Panel mints a `blob:` URL → SW `transcribe-file` → offscreen `offscreen-transcribe-file` → `decodeToMono16k` (OfflineAudioContext demux/resample to 16 kHz mono) → chunked Gemini Nano audio prompts (`transcribeChunk` clones a base session per 12 s window), same `transcription-progress`/`-complete` contract. No model download; unsupported hardware gets a loud "needs a GPU" state and captions still work. |

</feature_parity>

## Planning

For each work session, you must identify which features to work on by reading the parity table above.
Priority order is strict:

<priority_classification>

P0 — F-001 transcript extraction works in real Chrome (still needs a fresh sign-off
on every release per "How to verify the extension actually works"). The 2026-05-23
stabilization pass cut 15 AI prompts (Sentiment, Topics, Mindmap, Quotes, Quiz,
Flashcards, Study guide, Study notes, Generate Q&A, Blog outline, Social posts, SEO
keywords, Entities, Chapter summary, Action items) and the BilingualView component.
The 4 surviving AI surfaces are Summary, Key points, Q&A, and Chat. See `feature_parity`
above for status.

Lower-tier items (`TranscriptView.tsx` / `AiPanel.tsx` splits, icon-set
consolidation) remain out of scope unless a regression surfaces.
Transcription moved to Chrome Prompt API audio (Gemini Nano) in 2.0.0 — Whisper, the Hugging Face opt-in, and the Settings Audio tab are gone; Settings is now AI + Data only.

</priority_classification>

## Execution

***Important***: when working on features you must not pause unnecessarily, you must continue until you are
done with the current priority tier or you are truly unable to continue and need user interaction (you will
be penalized if you stop unnecessarily).

Keep in mind the feature parity table and follow these steps for each feature (you will be penalized if you
skip steps or do them in wrong order):

<execution_protocol>

1. **Verify preconditions.** Read the files you intend to modify. Confirm the existing code described in the
   parity table actually exists and matches what's described. If it doesn't exist or has changed, update your
   plan — do not blindly follow stale descriptions.

2. **Implement the feature.** Wire existing code where status is "EXISTS, NOT WIRED". Write new code where
   status is "MISSING". Do not rewrite code marked "DONE".

   <wiring_rules>
   - "EXISTS, NOT WIRED" means the backend logic/library code exists but is not connected to the UI.
     Your job is to add the UI integration (props, event handlers, state) — not to rewrite the library.
   - "MISSING" means no code exists. Write it from scratch following existing patterns in the codebase.
   - "DONE" means hands off. Do not modify unless fixing a bug the user reported.
   - "BLOCKED" means a prerequisite must be resolved first. Check if it has been resolved before skipping.
   </wiring_rules>

3. **Type-check.** Run `npm run lint` (which runs `tsc --noEmit`). Zero errors required. Fix all errors
   yourself — do not leave them for the user.

4. **Build.** Run `npm run build`. The extension must produce a working `dist/` directory. Fix any build
   errors yourself.

5. **Self-review.** Before claiming completion, verify:

   <completion_checklist>
   - [ ] Feature works in a 400px side panel (no horizontal scroll, no clipped content)
   - [ ] No `any` types introduced
   - [ ] No new npm dependencies added without justification
   - [ ] No network requests to tracking/analytics domains
   - [ ] AI features use Chrome built-in AI only (no API keys or provider setup)
   - [ ] chrome.storage used for persistence (not localStorage — this is an extension)
   - [ ] Existing tests still pass (if any)
   - [ ] No `console.log` left in production code (use `console.debug` behind a flag if needed)
   </completion_checklist>

6. **Report.** After completing a priority tier, produce a summary table:

   | Feature ID | Status Before | Status After | Files Changed |
   |-----------|--------------|-------------|--------------|
   | ... | ... | ... | ... |

</execution_protocol>

## Transcript Extraction Architecture

The extension uses an **intercept-first** model. YouTube's own UI loads the
transcript with full session auth (PO tokens, SAPISIDHASH, signed URLs); we
ride on top of that work instead of duplicating it.

<extraction_layers>

### L0 — MAIN-world fetch interceptor (primary)

`src/content/yt-interceptor.ts` runs in the page's JS context at
`document_start`, **before** YouTube's bundle initialises and stores its
own `fetch` reference in a closure. It patches `window.fetch` and
`XMLHttpRequest.prototype.open/send`. On responses to a fixed allowlist:

- `/youtubei/v1/get_transcript` — primary cue source
- `/youtubei/v1/player` — title, captionTracks, description (chapters)
- `/api/timedtext` — legacy timestamped-text shape

…it `.clone()`s the response and dispatches a `CustomEvent("yt-tx-capture")`
to the ISOLATED-world bridge. Every other URL is O(1) pass-through —
bodies are never read. MAIN-world has no `chrome.*`, hence the bridge.

`src/content/yt-bridge.ts` (ISOLATED, document_start) listens for
`yt-tx-capture` / `yt-tx-navigate`, parses the videoId out of the
request body (direct field for `player`, base64 protobuf field-1 decode
for `get_transcript`), and forwards to the service worker.

`src/lib/intercept/correlator.ts` keeps a per-tab map combining a
`player` capture (title, tracks, chapters) with a `get_transcript`
capture (segments) into one `TranscriptResponse` and emits it once to
the side panel as `intercepted-transcript`.

This works for VEVO music videos and other content YouTube gates
behind tokens we cannot replicate from MV3 — because we never make the
request, we just observe the one YouTube already made.

### L1 — paste-URL fallback

If the user pastes a URL for a video they're not actively watching, the
SW falls back to `src/background/innertube.ts`:

1. **WEB_EMBEDDED_PLAYER** Innertube call — exempt from PO tokens per
   the yt-dlp wiki. Returns `captionTracks[].baseUrl`.
2. **Watch-page scrape** — fetch `youtube.com/watch?v=ID`, regex out
   `ytInitialPlayerResponse`. Last resort.

Then `GET {baseUrl}&fmt=json3` for the timestamped events.

This path covers the rare "paste a link with no matching open tab"
case. For watch-page traffic L0 always wins.

### On-device transcription — Gemini Nano (when no caption transcript exists)

`src/background/transcribe/offscreen.ts` transcribes with Chrome's built-in
AI (Prompt API **audio input**) — the only engine as of 2.0.0. It runs in the
offscreen document because the Prompt API needs a document context (not the MV3
service worker) and audio input needs a GPU.

Two entry points, one inference path:

- **Tab audio** (captionless watch page): SW `chrome.tabCapture.getMediaStreamId`
  → offscreen `getUserMedia({chromeMediaSource:"tab"})` + `AudioWorkletNode`
  accumulating 12 s / 16 kHz mono windows.
- **Dropped file**: the side panel mints `URL.createObjectURL(file)` (blob URLs
  are same-origin between panel and offscreen), the SW forwards
  `offscreen-transcribe-file`, and `decodeToMono16k` runs
  `OfflineAudioContext(1,1,16000).decodeAudioData` — which demuxes the audio out
  of any container Chrome can decode and resamples to 16 kHz — then averages to
  mono.

Both feed `transcribeChunk(pcm)`: `pcmToAudioBuffer` wraps the window in an
`AudioBuffer`, a per-window `clone()` of a base `LanguageModel` session keeps
each chunk's context isolated, and `session.prompt([{role:"user", content:
[{type:"text", value: instruction}, {type:"audio", value: audioBuffer}]}])`
returns the text. Nano has **no per-cue timestamps**, so `Segment.start/duration`
are synthesized from the 12 s window offset — SRT/VTT and click-to-seek are
window-granular, not word-granular.

Gating: every run first calls `LanguageModel.availability({expectedInputs:
[{type:"audio"}], expectedOutputs:[{type:"text",languages:["en"]}]})`. On
`"unavailable"` it emits a clear "needs a supported GPU" error and the YouTube
caption path keeps working. Same `transcription-progress` / `-complete` /
`-error` / `offscreen-stop-capture` contract; the panel revokes the blob URL on
complete/error/stop.

Hardware: audio input requires Chrome desktop 138+ (extensions channel — no OT
token needed as of mid-2026), a GPU with >4 GB VRAM (no CPU fallback), a
supported desktop OS, and ~22 GB free for Chrome's managed Nano download. The
`availability()` probe is the only per-machine truth — never assume "available".

</extraction_layers>

### Known Risks

- YouTube can change its `get_transcript` JSON shape — `parseGetTranscript.ts`
  handles both shapes seen in production; add new ones there.
- YouTube can `Object.freeze(window)` in the future, fighting fetch
  re-patching. Currently doesn't.
- `world: "MAIN"` + `run_at: "document_start"` is "best-effort first" per
  Chrome — usually we beat YouTube's bundle, occasionally not. If a video
  doesn't auto-populate on first nav, a SPA navigation away and back
  re-fires the interceptor.
- Transcription is GPU-only (Nano audio has no CPU fallback) and needs Chrome 138+; the `availability()` probe gates it and the YouTube caption path is unaffected. The Nano audio path (chunk sizing, timestamp granularity, transcript accuracy) still needs a real-Chrome sign-off — it can't run in CI/headless.
- L0 only fires on watch pages — paste-URL flows still need L1.

</extraction_layers>

## AI Prompt Templates

All AI features route through Chrome built-in AI in `lib/ai/chrome-ai.ts`. Adding a new AI feature
means adding a prompt template to `lib/ai/prompts.ts` and a button/section in `AiPanel.tsx`.

<ai_prompt_inventory>

| Prompt ID    | Feature | Status   | Notes                                                              |
|--------------|---------|----------|--------------------------------------------------------------------|
| summary      | F-006   | **DONE** | 3-5 sentence summary                                               |
| bulletPoints | —       | **DONE** | "Key points" button — 5-10 bullets                                 |
| qaExtract    | F-009   | **DONE** | Q&A button — 5-15 timestamped pairs                                |
| chat         | F-010   | **DONE** | Bottom "Ask" input — conversational Q&A grounded in the transcript |

Previously shipped prompts (sentiment, topics, quotes, mindmap, quiz, flashcards,
studyGuide, studyNotes, qaGenerate, blogOutline, socialPosts, seoKeywords, entities,
chapterSummary, actionItems) were removed on 2026-05-23. Anything they did is reachable
via the Ask box on demand.

The user-facing surface is now 3 buttons + the Ask box. There is no "More" disclosure.

To add a new prompt:

1. Add an entry to `AiFeature` in `src/types/transcript.ts`
2. Add a `PromptTemplate` to `promptTemplates` in `lib/ai/prompts.ts` (instructions only —
   the caller appends the transcript; Chrome AI measures it via `fitToQuota`)
3. Add a button entry to `FEATURES` in `AiPanel.tsx`

**Chrome AI sizing rule** (`chrome-ai.ts:fitToQuota`):

- **Chrome AI** — adaptive. `session.measureInputUsage` drives a binary head+tail trim
  to fit the actual quota of the user's Gemini Nano build. Never throws "Input is too
  large" again.
</ai_prompt_inventory>

## Project Structure

```
yt-transcript/
  src/
    background/
      service-worker.ts            # Message router; correlator broadcasts;
                                   # transcription offscreen lifecycle
      innertube.ts                 # Paste-URL fallback only — single
                                   # WEB_EMBEDDED_PLAYER client + watch-page scrape
      innertube-browse.ts          # Playlist/channel browse via Innertube
      providers/
        types.ts                   # TranscriptProvider interface, isApiError
        youtube.ts                 # Wraps innertube.ts behind the provider iface
      transcribe/
        offscreen.ts               # Tab-audio capture + dropped-file decode +
                                   # Gemini Nano audio transcription (Prompt API)
        worklet-processor.ts       # AudioWorkletProcessor (separate bundle)
        offscreen.html             # Document loaded by chrome.offscreen
    content/
      yt-interceptor.ts            # MAIN-world, document_start. Patches fetch + XHR,
                                   # captures get_transcript / player / timedtext
      yt-bridge.ts                 # ISOLATED, document_start. Forwards captures to SW
      content.ts                   # ISOLATED, document_idle. Video-detect + seek-to
                                   # + 1 Hz player-time relay (no DOM extraction)
    sidepanel/                     # Vite entry point for side panel UI
      index.html
      main.tsx
      App.tsx                      # Side-panel shell, listens for intercepted-transcript
                                   # and shows the "Live" pill on auto-populate
    components/
      UrlInput.tsx                 # URL input + validation; landing screen + compact mode
      TranscriptView.tsx           # Transcript display, view modes, search (~26 KB)
      ExportBar.tsx                # Copy + download buttons (all 6 formats)
      AiPanel.tsx                  # AI features panel: Summary / Key points / Q&A buttons + Ask (chat) box
      Settings.tsx                 # AI status + Data (export/clear) tabs
      History.tsx                  # Recent history modal
      SavedList.tsx                # Saved transcripts modal
      BatchProgress.tsx            # Batch processing progress + per-item exports
      BatchResultsNav.tsx          # Navigate between batch results
      ErrorMessage.tsx             # Quiet error block + optional Transcribe-locally CTA
      LoadingSpinner.tsx           # Skeleton loader
      LegalPage.tsx                # Legal/privacy hash route (#/legal)
      TagEditor.tsx                # Tag chip input on saved transcripts
    lib/
      parseUrl.ts                  # YouTube URL → video ID + URL kind
      formatTime.ts                # Seconds → timestamp strings
      mergeSegments.ts             # Raw → sentence → paragraph merging
      cleanText.ts                 # Filler-word removal (wired; dead profanity filter removed 2026-07-22)
      parseChapters.ts             # Chapter timestamp parsing
      sanitizeFilename.ts          # Title → safe filename
      exportTxt.ts                 # TXT export
      exportSrt.ts                 # SRT export
      exportVtt.ts                 # VTT export
      exportJson.ts                # JSON export
      exportCsv.ts                 # CSV export
      exportMarkdown.ts            # Markdown / Notion / Obsidian
      ai/
        prompts.ts                 # Prompt templates (all DONE — see ai_prompt_inventory)
        chrome-ai.ts               # Chrome built-in Prompt API + Summarizer wrappers
      intercept/
        parseGetTranscript.ts      # youtubei/v1/get_transcript JSON → Segment[]
                                   # (handles both response shapes seen in prod)
        correlator.ts              # SW-side per-tab merge of player + transcript
                                   # captures into TranscriptResponse
      storage/
        history.ts                 # chrome.storage recent history
        saved.ts                   # IndexedDB saved transcripts + highlights + notes
        preferences.ts             # chrome.storage user preferences
      batch/
        queue.ts                   # Concurrent batch processing (default 4
                                   # workers, clamped 1-8) with progress
    types/
      transcript.ts                # Shared types
      messages.ts                  # Extension message protocol types
  dist/                            # Built extension — load as unpacked in Chrome
  manifest.json                    # MV3 manifest (3 YouTube content_scripts entries)
  vite.config.ts
  scripts/
    build.mjs                      # Vite + esbuild orchestrator (7 bundles)
  package.json
```

## CLI Transcript Tool

This repo includes a CLI transcript extractor at `scripts/transcribe` that works outside the browser.
Use it when you need video content as text — summarize, analyze, explain, extract quotes, etc.

```bash
./scripts/transcribe "https://www.youtube.com/watch?v=VIDEO_ID"
```

Returns: title, channel, duration, timestamped transcript text.

| Flag | Effect |
|------|--------|
| `--json` | Output structured JSON instead of plain text |
| `--no-timestamps` | Omit `[MM:SS]` prefixes from lines |

Requires: `yt-dlp` (`brew install yt-dlp` or `pip install yt-dlp`), `python3`.

## Build and Test

```bash
npm run dev          # Vite dev server (side panel only, no extension APIs)
npm run build        # Production build → dist/
npm run zip          # Build + zip for store submission
npm run lint         # tsc --noEmit (type check)
```

To test the extension: `npm run build` → Chrome → `chrome://extensions` → Developer mode →
"Load unpacked" → select `dist/` → open any YouTube video → side panel populates automatically
via the MAIN-world interceptor. Click the toolbar icon to open the side panel if it isn't pinned.

After reloading the extension in chrome://extensions, also reload any open YouTube tabs once so
they pick up the new content scripts (orphaned scripts are safe — they shut down quietly — but
they won't broadcast captures until refreshed).

### Node version

The build runs cleanly on Node 22.x or 25.x. If your Homebrew Node 25
on Apple Silicon fails to start (missing `libsimdjson.31.dylib` after
a Homebrew simdjson upgrade), either `brew reinstall node` once or use
`nvm use 22` before running build commands. The verification snippets
below use plain `npm run build` and assume whichever Node the project
sees on PATH is usable — add an `.nvmrc` if you want `nvm` to switch
automatically.
 
## Deferred / out of scope

- **`TranscriptView.tsx` / `AiPanel.tsx` splits** — bloat is real but
  splitting carries regression risk for no immediate user-visible win.
  `AiPanel.tsx` is now considerably smaller after the feature cut; still
  not a priority.
- **Inline-SVG → `components/icons.tsx` consolidation** — four files
  duplicate the close-X glyph; the rest are unique. Low-impact.
- **YouTube Music app, YouTube Live captions, ffmpeg.wasm for exotic drop-file
  containers (mkv/avi/ts/mxf — Chrome natively decodes mp4/webm/mov/mp3/m4a/wav),
  floating overlay, Web Neural Network API.** Vimeo support and Whisper were
  removed in 2.0.0 — any non-YouTube video now goes through the universal
  tab-capture / drop-file Nano path.

## Validation Checklist

After completing any work session, verify:

<validation>

1. **Compilation**: `npm run lint` — zero TypeScript errors
2. **Build**: `npm run build` — produces working `dist/` directory
3. **No regressions**: Features marked "DONE" in the parity table still work
4. **Side panel fit**: All UI renders correctly at 400px width
5. **No paid services**: No API keys, no backend calls, no tracking
6. **Extension APIs**: Uses `chrome.storage` not `localStorage`, `chrome.runtime.sendMessage` not `window.postMessage`
7. **Type safety**: No `any` types, no `@ts-ignore`, no `as unknown as X` hacks

</validation>

## How to verify the extension actually works

The Playwright spec under `e2e/transcript-extraction.spec.ts` is the
test harness, but it runs against Playwright's chrome-for-testing
build which YouTube actively bot-detects (anonymous session, no
PO token, no storage-access permission). That environment will report
`HTTP 200 + 0 bytes` for every signed `/api/timedtext` URL and the
test will fail end-to-end — even when the code is correct. Treat the
Playwright run as a regression guard for the **path** (does the
side panel reach the intercept correlator? does it stop firing the
activeTab cascade?), not for **content** (do captions render?).

For content verification you need a real Chrome with a real YouTube
session:

```bash
# 1. Build fresh
npm run build

# 2. Load unpacked
#    Chrome → chrome://extensions → enable Developer mode →
#    "Load unpacked" → select dist/. Disable / remove the published
#    Web Store version first to avoid two copies fighting for the
#    side-panel slot.

# 3. Reload any open YouTube tabs (the MAIN-world interceptor only
#    attaches at document_start; existing tabs ran without it).

# 4. Open the side panel on a YouTube watch page. The "Live" pill
#    should appear under the wordmark within a few seconds and the
#    transcript should auto-populate.

# 5. Paste-URL recovery (architecturally separate from auto-detect):
#    a. Switch to a non-YouTube tab (e.g. a blank `about:blank` tab).
#    b. Open the side panel from the toolbar.
#    c. Paste a YouTube URL like
#       `https://www.youtube.com/watch?v=dQw4w9WgXcQ` into the input.
#    d. Within ~2–6 s a temporary background tab opens, the MAIN-world
#       interceptor fires for it, and the side panel populates. The
#       background tab auto-closes once segments arrive (see
#       `captureViaYouTubeTab` in `App.tsx`).

# 6. On-device Nano transcription (captionless video or dropped file):
#    a. Precondition — on any https page, DevTools console:
#         await LanguageModel.availability({expectedInputs:[{type:"audio"}],
#           expectedOutputs:[{type:"text",languages:["en"]}]})
#       Must return "available" (or "downloadable"/"downloading"). "unavailable"
#       means this machine can't run it (no GPU / old Chrome) — expected on many
#       laptops; the panel then shows a "needs a GPU" state and captions still
#       work. (Confirmed "available" on Apple Silicon + recent Chrome, 2026-07.)
#    b. Drop a video/audio file with speech anywhere in the panel (or use the
#       landing picker). Segments should stream in ~every 12 s of decoded audio.
#    c. Captionless watch page: the panel surfaces a "Transcribe locally" CTA;
#       clicking it pipes tab audio through the offscreen Nano path.
#    d. Unsupported machine: confirm the explicit "on-device transcription isn't
#       available … needs a supported GPU" error instead of silence.

# 7. To inspect the chain when something goes wrong:
#    a. chrome://extensions → yt-transcript → "service worker"
#       opens DevTools for the SW. Look for `[intercept] kind=...`,
#       `[auto-fetch] ...` log lines.
#    b. On the YouTube tab, the page console shows content-script
#       output (the ANDROID_VR + DOM player fetches in content.ts).
#    c. The side panel itself: right-click → Inspect.
#    d. The offscreen document: chrome://extensions → yt-transcript →
#       "Inspect views: offscreen.html" — shows the Nano
#       availability()/create()/prompt() calls (no download).
```

The Playwright spec is still useful for the path test. Run it with:

```bash
npm run build && \
  npx playwright install chromium && \
  npx playwright test e2e/transcript-extraction.spec.ts
```

## Store Publishing

Chrome Web Store listing id: `ahddbfbjafmbceehebpeanpnlbaimepk`, generic name
**Video Transcript** (the old branded name drew a trademark complaint — see the
naming rule at the top). Two release lines are in flight:

- **1.5.2 (tag `v1.5.2`) — trademark-remediation interim, the one to SHIP now.**
  Whisper-based, works on all hardware, generic name/icon/listing, every residual
  platform name stripped from user-visible strings. This is what closes the Vimeo
  trademark complaint. Publish flow: fix the Privacy-tab justifications (storage
  must NOT claim "API keys"; host-permission field must include `vimeo.com` —
  1.5.2 still ships Vimeo), upload `yt-transcript-chrome.zip`, submit. The Edge
  listing (Product ID `069ca91d-a7cd-4bac-8224-1ee38a2d2a06`) stays unpublished
  pending the modification form.
- **2.0.0 (tag `v2.0.0`) — universal Gemini Nano rewrite, ships AFTER real-Chrome
  sign-off.** Whisper + Vimeo removed; transcription is Chrome Prompt API audio
  (GPU-only, desktop, Chrome 138+). Bundle ~708 KB (was 6.7 MB), 0 npm
  vulnerabilities, no `huggingface.co` / `optional_host_permissions`, no
  `wasm-unsafe-eval`. Do NOT publish 2.0.0 until the Nano audio path is verified
  in real Chrome (see "How to verify") — it silently excludes non-GPU users from
  transcription (their captions still work).

Keep `manifest.json` + `package.json` versions in lockstep for every upload.
`npm run zip` produces `yt-transcript-chrome.zip`. No other browser store targets.
Refresh `store/images/` screenshots if the listing shows a stale Settings panel.

<!-- MAF Doctor steering — managed by `maf-doctor init`; .claude/maf-doctor.md is overwritten on re-run -->
@.claude/maf-doctor.md

<!-- BEGIN maf-doctor (managed by `maf-doctor init` — overwritten on re-run) -->
## Microsoft Agent Framework — MAF Doctor is installed

This repository uses Microsoft Agent Framework. The maf-doctor MCP server
(also called "MAF Doctor") is installed and exposes tools for diagnosing,
fixing, and migrating MAF code.

**Before answering MAF questions or proposing changes:**

1. **Always call `MafDoctor` first** on the repo path to get the current
   health grade (A-F) and the top issues. Don't speculate about MAF
   quality without this baseline.

2. **For any `[Obsolete]` warning, `CS0618` / `CS0246` diagnostic, or build
   failure mentioning a MAF type** — call `MafRunCs0618Hunt` (full project
   scan) or `MafApiSafety` (single symbol) BEFORE suggesting a fix. The
   maf-doctor registry has curated fix recipes that supersede your
   training data — MAF ships breaking changes every minor version, so
   training data is likely outdated.

3. **To fix issues** — `MafAutoFixAll --dry-run` then apply handles the
   *mechanical* rules deterministically (offer this first; the rewrites are
   tested). To fix **everything**, run the `maf-remediate` prompt (or just
   ask "fix all the issues maf-doctor found"): it grades → plans → autofixes
   → then works each semantic finding. Every finding carries a **`confidence`**
   (`certain` / `high` / `heuristic`); a **`heuristic`** finding may be a
   **false positive** — confirm it with `MafExplainFinding` before editing.
   Get the plan via `MafDoctor(format: "plan")` (human) or `--plan --json`
   (structured manifest); per-rule fix + false-positive guidance lives in the
   `maf-remediation-playbook` skill.

4. **When designing a new MAF agent or workflow** — call `MafNewAgent` /
   `MafNewExecutor` for scaffolds, or `MafSimulateWorkflow` for topology
   preview. Don't reconstruct patterns from memory.

5. **For deep architectural / security / migration questions** — use the
   `@maf-best-practice-reviewer`, `@maf-auditor`, `@maf-migration`, or
   `@maf-incident-responder` specialist agents.

6. **To migrate FROM Semantic Kernel TO MAF** (a cross-framework port, NOT a
   MAF version bump) — call `MafDetectSourceFramework` (CLI:
   `maf-doctor migrate-scan`) to inventory SK usage and scope it, then run the
   `maf-migrate-from` prompt or the `@maf-cross-migration` agent. It scaffolds a
   **new MAF project beside the original** and ports it construct-by-construct,
   non-destructively. The mapping lives at `maf://migrate-from?source=semantic-kernel`.

maf-doctor tools are MAF-version-aware via `applies_to_codebases` markers
in the registry — they know which fix applies to which MAF version. Defer to
the tools.
<!-- END maf-doctor -->
