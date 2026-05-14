# YouTube Transcript Extractor — Browser Extension

## Scope

Free MV3 browser extension (Chrome/Edge side panel) that replaces youtube-transcript.io with zero cost.
Everything they gate behind credits, logins, or paid tiers — we do free, locally, no backend.

When you are asked to work on this project, you must read this entire file first. Do not skip sections.
Do not propose changes that violate the hard constraints. Do not ask clarifying questions when the answer
is in this file.

## Hard Constraints

- **ZERO COST.** No backend. No paid APIs. No accounts. No credits. No server. Extension only.
- **AI = BYOK or Chrome built-in AI only.** User provides their own API key. Key stored in chrome.storage only. Never sent to our server (we have no server). AI calls go browser → provider API directly. Chrome built-in AI (window.ai) is the free-tier default.
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
- `TranscriptView.tsx` (~26KB after the cleanup pass) and `AiPanel.tsx`
  (~16KB) are still on the chunky side. Split only if you're already
  modifying them and the change is non-trivial.
- Inline SVGs still appear in several components. Four files duplicate the
  same close-X glyph; consolidate when you touch icon code.
- Local Whisper runs in an offscreen document via `chrome.tabCapture` +
  `AudioWorkletNode` + `@huggingface/transformers` v3 (WebGPU when
  available, WASM fallback). Model weights stream from the Hugging Face
  CDN on first use, then cache in `caches` storage.

## Competitive Target

We replace youtube-transcript.io feature-for-feature. This is the parity table:

<feature_parity>

| ID | Their Feature | Their Tier | Our Status | Our Approach |
|----|---|---|---|---|
| F-001 | Single transcript extraction | Free (25/mo cap) | **BROKEN** | Intent: intercept-first MAIN-world fetch hook (`yt-interceptor.ts`) + paste-URL Innertube fallback (`innertube.ts`). Current behaviour on a paste from the side panel: error "Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured." No captions are fetched. Every downstream feature in this table is gated on F-001 being repaired. |
| F-002 | Playlist bulk extraction | Plus ($9.99/mo) | **DONE** | `UrlInput.tsx` detects playlist URLs → `chrome.runtime.sendMessage({type:"fetch-playlist"})` → video selection panel → batch queue |
| F-003 | CSV bulk upload | Plus | **DONE** | `UrlInput.tsx` file input accepts `.csv/.txt`, parses video IDs via `parseVideoId`, feeds into `onSubmitBatch` |
| F-004 | Channel ID finder + transcripts | Plus/Pro | **DONE** | `UrlInput.tsx` detects channel URLs → `chrome.runtime.sendMessage({type:"fetch-channel"})` → selection panel → batch |
| F-005 | Transcript history | 3d free / 90d paid / unlimited Pro | **DONE** | `lib/storage/history.ts` + `History.tsx` modal |
| F-006 | AI Summary | Login + credits | **DONE** | `promptTemplates.summary` in `prompts.ts`, button in `AiPanel.tsx` |
| F-007 | AI Sentiment analysis | Login + credits | **DONE** | `promptTemplates.sentiment` — tone, bias, emotional arc analysis |
| F-008 | AI Topic extraction / hashtags | Login + credits | **DONE** | `promptTemplates.topics` — primary/secondary topics + hashtags |
| F-009 | AI Q&A from transcript | Login + credits | **DONE** | `promptTemplates.qaExtract` — direct answers with timestamps |
| F-010 | Chat with transcript | Beta/paid | **DONE** | `AiPanel.tsx` chat section with `getChatSystemPrompt` |
| F-011 | Summarize transcript | Credits | **DONE** | Same as F-006 |
| F-012 | Mindmap | Credits | **DONE** | `promptTemplates.mindmap` — outputs mermaid diagram syntax |
| F-013 | Key Quotes | Credits | **DONE** | `promptTemplates.quotes` — notable quotes with timestamps |
| F-014 | Study Guide | Credits | **DONE** | `promptTemplates.studyGuide` — objectives, concepts, notes, review questions |
| F-015 | Q&A Generation | Credits | **DONE** | `promptTemplates.qaGenerate` — factual/conceptual/application Q&A pairs |
| F-016 | Quiz | Credits | **DONE** | `promptTemplates.quiz` — 10-question multiple choice with explanations |
| F-017 | Flash Cards | Credits | **DONE** | `promptTemplates.flashcards` + `FlashcardView` component in `AiPanel.tsx` |
| F-018 | Highlights | Credits | **DONE** | Per-segment highlight/note icons in `TranscriptView.tsx:510-582`, IndexedDB persistence via `App.tsx:274-295`, "Highlights" copy button in `ExportBar.tsx` |
| EXTRA-001 | Filler word removal | They don't have this | **DONE** | Toggle in `TranscriptView.tsx:419-421`, applies `removeFillersFromSegments` in `displaySegments` memo, exports respect toggle via `ExportBar.tsx:39-41` |
| EXTRA-002 | Speaker labels | They don't have this | **DONE** | `detectSpeakers()` at `TranscriptView.tsx:168`, colored tags at `:497-501`, filter dropdown at `:424-435` |
| EXTRA-003 | Chapter extraction | They don't have this | **DONE** | `parseChapters.ts` parses description timestamps, `innertube.ts:265` includes chapters, collapsible dividers in `TranscriptView.tsx:516-530`, chapter headings in Markdown export via `exportMarkdown.ts:renderBody` |
| EXTRA-004 | Bilingual side-by-side | They don't have this | **EXISTS** | `BilingualView.tsx` component exists, not wired to main UI |
| EXTRA-005 | 6 export formats | They only have copy | **DONE** | TXT, SRT, VTT, JSON, CSV, Markdown + Notion + Obsidian variants |
| EXTRA-006 | Offline | They don't have this | **DONE** | Works without internet once fetched |

</feature_parity>

## Planning

For each work session, you must identify which features to work on by reading the parity table above.
Priority order is strict:

<priority_classification>

P0 — repair F-001 (Single transcript extraction). The side panel currently surfaces an `activeTab` /
`captureVisibleTab` error before any captions are returned, which means every "DONE" row in the parity
table that consumes a `TranscriptResponse` is unreachable in practice. Until an E2E run shows ≥10 caption
rows for a real video, treat the table as wiring-only — the pipeline is not proven end-to-end.

Lower-tier items (EXTRA-004 Bilingual side-by-side, the `TranscriptView.tsx` / `AiPanel.tsx` splits,
icon-set consolidation, Hugging Face host-permission opt-in) remain out of scope until F-001 is verified
green by the harness under `e2e/`.

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
   - [ ] AI features use BYOK routing only (never hardcoded API keys)
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

### Local Whisper (when no transcript exists at all)

`src/background/transcribe/offscreen.ts` captures tab audio via
`chrome.tabCapture` + `AudioWorkletNode` and runs Whisper through
`@huggingface/transformers` v3 — WebGPU + dtype `q4f16` when
`navigator.gpu` is present, WASM + `q8` fallback otherwise. Model
weights stream from the Hugging Face CDN on first use and cache in
`caches` storage.

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
- WebGPU isn't universal; WASM fallback is the safety net.
- L0 only fires on watch pages — paste-URL flows still need L1.

</extraction_layers>

## AI Prompt Templates

All AI features route through the same BYOK pipeline in `lib/ai/providers.ts`. Adding a new AI feature
means adding a prompt template to `lib/ai/prompts.ts` and a button/section in `AiPanel.tsx`.

<ai_prompt_inventory>

| Prompt ID | Feature | Status | Notes |
|-----------|---------|--------|-------|
| summary | F-006, F-011 | **DONE** | Key points + TLDR |
| sentiment | F-007 | **DONE** | Tone, bias, emotional arc |
| topics | F-008 | **DONE** | Tags, hashtags, main themes |
| qaExtract | F-009 | **DONE** | Direct answers found in transcript |
| chat | F-010 | **DONE** | Conversational Q&A grounded in transcript |
| mindmap | F-012 | **DONE** | Output as mermaid diagram syntax |
| quotes | F-013 | **DONE** | Notable quotes with timestamps |
| studyGuide | F-014 | **DONE** | Structured study material |
| qaGenerate | F-015 | **DONE** | Question-answer pairs for review |
| quiz | F-016 | **DONE** | Multiple choice with correct answers marked |
| flashcards | F-017 | **DONE** | Flashcard deck |
| action-items | — | **DONE** | Action items (our extra, they don't have it) |
| chapterSummary | — | **DONE** | One-line summary per detected chapter |
| bulletPoints | — | **DONE** | Standalone key-points feature (separate from summary's TLDR) |
| studyNotes | — | **DONE** | Cornell-style study notes |
| blogOutline | — | **DONE** | Long-form blog outline from transcript |
| socialPosts | — | **DONE** | Twitter/LinkedIn-shaped post drafts |
| seoKeywords | — | **DONE** | SEO keyword extraction |
| entities | — | **DONE** | Named entity extraction |

The user-facing buttons are split into 6 essentials shown by default and
the rest behind a "More" disclosure in `AiPanel.tsx`.

To add a new prompt:
1. Add the template function to `lib/ai/prompts.ts` following existing pattern
2. Add an entry to `ESSENTIAL_FEATURES` or `MORE_FEATURES` in `AiPanel.tsx`
3. Use the existing `sendMessage()` from the provider — no new wiring needed

</ai_prompt_inventory>

## Project Structure

```
yt-transcript/
  src/
    background/
      service-worker.ts            # Message router; correlator broadcasts;
                                   # Whisper offscreen lifecycle
      innertube.ts                 # Paste-URL fallback only — single
                                   # WEB_EMBEDDED_PLAYER client + watch-page scrape
      innertube-browse.ts          # Playlist/channel browse via Innertube
      providers/
        types.ts                   # TranscriptProvider interface, isApiError
        youtube.ts                 # Wraps innertube.ts behind the provider iface
        vimeo.ts                   # Vimeo player.vimeo.com/.../config + VTT parse
      transcribe/
        offscreen.ts               # Tab-audio capture + Whisper inference
                                   # (transformers.js v3, WebGPU/q4f16 → WASM/q8)
        worklet-processor.ts       # AudioWorkletProcessor (separate bundle)
        offscreen.html             # Document loaded by chrome.offscreen
    content/
      yt-interceptor.ts            # MAIN-world, document_start. Patches fetch + XHR,
                                   # captures get_transcript / player / timedtext
      yt-bridge.ts                 # ISOLATED, document_start. Forwards captures to SW
      content.ts                   # ISOLATED, document_idle. Video-detect + seek-to
                                   # + 1 Hz player-time relay (no DOM extraction)
      vimeo-content.ts             # Vimeo equivalent of content.ts (still does
                                   # page-config DOM extraction; Vimeo's auth is simpler)
    sidepanel/                     # Vite entry point for side panel UI
      index.html
      main.tsx
      App.tsx                      # Side-panel shell, listens for intercepted-transcript
                                   # and shows the "Live" pill on auto-populate
    components/
      UrlInput.tsx                 # URL input + validation; landing screen + compact mode
      TranscriptView.tsx           # Transcript display, view modes, search (~26 KB)
      ExportBar.tsx                # Copy + download buttons (all 6 formats)
      AiPanel.tsx                  # AI features panel (~16 KB) with Essentials + More
      Settings.tsx                 # BYOK API keys, Chrome AI, Ollama, Whisper, prefs
      History.tsx                  # Recent history modal
      SavedList.tsx                # Saved transcripts modal
      BatchProgress.tsx            # Batch processing progress + per-item exports
      BatchResultsNav.tsx          # Navigate between batch results
      BilingualView.tsx            # Side-by-side original + translated (NOT WIRED)
      ErrorMessage.tsx             # Quiet error block + optional Transcribe-locally CTA
      LoadingSpinner.tsx           # Skeleton loader
      LegalPage.tsx                # Legal/privacy hash route (#/legal)
      TagEditor.tsx                # Tag chip input on saved transcripts
    lib/
      parseUrl.ts                  # YouTube/Vimeo URL → video ID + URL kind
      formatTime.ts                # Seconds → timestamp strings
      mergeSegments.ts             # Raw → sentence → paragraph merging
      cleanText.ts                 # Filler-word + profanity filter (wired)
      detectSpeakers.ts            # Speaker label heuristics (wired)
      parseChapters.ts             # Chapter timestamp parsing
      parseVtt.ts                  # WebVTT parser used by Vimeo provider
      sanitizeFilename.ts          # Title → safe filename
      exportTxt.ts                 # TXT export
      exportSrt.ts                 # SRT export
      exportVtt.ts                 # VTT export
      exportJson.ts                # JSON export
      exportCsv.ts                 # CSV export
      exportMarkdown.ts            # Markdown / Notion / Obsidian
      ai/
        providers.ts               # OpenAI, Anthropic, Google, Ollama, Chrome AI
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
        queue.ts                   # Sequential batch processing with progress
    types/
      transcript.ts                # Shared types
      messages.ts                  # Extension message protocol types
  dist/                            # Built extension — load as unpacked in Chrome
  manifest.json                    # MV3 manifest (4 content_scripts entries)
  vite.config.ts
  scripts/
    build.mjs                      # Vite + esbuild orchestrator (8 bundles)
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

Homebrew Node 25 on Apple Silicon currently fails to start (missing
`libsimdjson.31.dylib` after a Homebrew simdjson upgrade). Until that's
relinked, prefer the nvm-installed Node v22:

```bash
PATH="/Users/ancplua/.nvm/versions/node/v22.21.1/bin:$PATH" npm run build
```

Or fix Homebrew once with `brew reinstall node`.
 
## Deferred / out of scope

The bleeding-edge rewrite (commits `832684c` … `5e1e9ec`) intentionally
left the following undone. Pull any of them into the next session if
asked, otherwise leave alone:

- **EXTRA-004 wiring (`BilingualView.tsx`)** — the component exists but has
  no toolbar entry. Wiring it needs a target-language picker and dual-track
  state in `App.tsx`, plus a new view mode in `TranscriptView.tsx`.
- **`TranscriptView.tsx` / `AiPanel.tsx` splits** — bloat is real but
  splitting carries regression risk for no immediate user-visible win.
- **Inline-SVG → `components/icons.tsx` consolidation** — four files
  duplicate the close-X glyph; the rest are unique. Low-impact.
- **Hugging Face Hub host-permission opt-in** — `manifest.json` does *not*
  list `huggingface.co`. Whisper still works because transformers.js
  fetches via standard CORS. To strictly honour the "no surprise network
  requests" privacy line, ask the user via `chrome.permissions.request`
  before the first model download.
- **YouTube Music app, YouTube Live captions, Prompt-API audio multimodal,
  Vimeo MAIN-world interceptor, packaged offline Whisper, floating overlay,
  Web Neural Network API.**

## Validation Checklist

After completing any work session, verify:

<validation>

1. **Compilation**: `npm run lint` — zero TypeScript errors
2. **Build**: `npm run build` — produces working `dist/` directory
3. **No regressions**: Features marked "DONE" in the parity table still work
4. **Side panel fit**: All UI renders correctly at 400px width
5. **No paid services**: No API keys hardcoded, no backend calls, no tracking
6. **Extension APIs**: Uses `chrome.storage` not `localStorage`, `chrome.runtime.sendMessage` not `window.postMessage`
7. **Type safety**: No `any` types, no `@ts-ignore`, no `as unknown as X` hacks

</validation>

## Store Publishing

The extension is not in a publishable state until F-001 is repaired and proven by the E2E harness.
When that happens and a build is genuinely accepted by Chrome Web Store / Firefox Add-ons / Edge
Add-ons, this section can be replaced with the actual listing URLs and install instructions. Do not
add store badges or "live" status before that point.
