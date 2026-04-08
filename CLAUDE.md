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

- This project was built by parallel agents who left gaps. Code exists but is not wired. Do not rewrite working code — wire it.
- The Innertube API is undocumented and YouTube changes it without notice. Every approach must have a fallback.
- Side panel width is ~400px. Components designed for full-page layouts must be adapted.
- `TranscriptView.tsx` (28KB) and `AiPanel.tsx` (18KB) are bloated. Split only if you're already modifying them.
- Inline SVGs are scattered everywhere. Consolidate to a consistent approach when touching icon code.

## Competitive Target

We replace youtube-transcript.io feature-for-feature. This is the parity table:

<feature_parity>

| ID | Their Feature | Their Tier | Our Status | Our Approach |
|----|---|---|---|---|
| F-001 | Single transcript extraction | Free (25/mo cap) | **DONE** | 3-layer fallback: content script DOM → WEB_EMBEDDED_PLAYER → watch page scrape (`innertube.ts:resolvePlayer`) |
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

All P0–P3 items are complete. Only EXTRA-004 (Bilingual side-by-side) remains unwired — it exists as a
standalone component but is not integrated into the main UI flow. This is a future enhancement, not a
parity blocker.

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

## Innertube API Reference

This is how transcript extraction works. Do not deviate from this unless YouTube changes it.

<innertube_api>

### Layer 1: Content Script DOM Extraction (preferred)

The content script (`content/content.ts`) extracts `ytInitialPlayerResponse` from the YouTube watch page DOM.
This is the most reliable method because:
- Runs in the page context with the user's cookies/session
- No CORS issues
- No IP blocking (user's own browser)
- YouTube has already authenticated the user

The content script caches the response and responds to `request-player-data` messages from the service worker.

### Layer 2: WEB_EMBEDDED_PLAYER Client

```json
{
  "context": {
    "client": {
      "clientName": "WEB_EMBEDDED_PLAYER",
      "clientVersion": "1.20260101.00.00"
    }
  },
  "videoId": "VIDEO_ID"
}
```

WEB_EMBEDDED_PLAYER is exempt from PO token requirements. Use as fallback when content script extraction
fails (e.g., user navigated away from the video page).

### Layer 3: Watch Page Scrape

Fetch `youtube.com/watch?v=ID` via the service worker, parse `ytInitialPlayerResponse` from the HTML.
Most fragile — use only when layers 1 and 2 fail.

### Caption Track Fetching

From any layer's player response, extract `captions.playerCaptionsTracklistRenderer.captionTracks[]`.
Each track has `baseUrl`, `languageCode`, `kind` ("asr" = auto-generated), `name.simpleText`.

Fetch transcript: `GET {baseUrl}&fmt=json3`
For translation: `GET {baseUrl}&fmt=json3&tlang={targetLangCode}`

Response:
```json
{
  "events": [
    { "tStartMs": 1500, "dDurationMs": 3000, "segs": [{ "utf8": "Hello " }, { "utf8": "world" }] }
  ]
}
```

Parse: concatenate `segs[].utf8` per event. `tStartMs / 1000` = start seconds. Skip events with no `segs`.

### Known Risks

- YouTube broke all HTML-scraping tools ~June 2025 by changing authentication
- PO tokens now required per-video for WEB client (not WEB_EMBEDDED_PLAYER)
- ANDROID client now requires PO tokens per yt-dlp wiki
- Innertube API has no stability guarantees

</innertube_api>

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

To add a missing prompt:
1. Add the template function to `lib/ai/prompts.ts` following existing pattern
2. Add a button + result display section to `components/AiPanel.tsx`
3. Use the existing `sendMessage()` from the provider — no new wiring needed

</ai_prompt_inventory>

## Project Structure

```
yt-transcript/
  src/
    background/
      service-worker.ts          # Extension background — message routing, Innertube orchestration
      innertube.ts               # Innertube API client (3-layer fallback)
      innertube-browse.ts        # Playlist/channel browse via Innertube
    content/
      content.ts                 # Content script — DOM extraction, page data caching
    sidepanel/                   # Vite entry point for side panel UI
    components/
      UrlInput.tsx               # URL input + validation
      TranscriptView.tsx         # Transcript display, view modes, search (28KB — bloated)
      ExportBar.tsx              # Copy + download buttons (all 6 formats)
      AiPanel.tsx                # AI features panel (18KB — bloated)
      Settings.tsx               # BYOK API key management + preferences
      History.tsx                # Recent history panel
      SavedList.tsx              # Saved transcripts panel
      BatchInput.tsx             # Batch/playlist URL input
      BatchProgress.tsx          # Batch processing progress
      BatchResultsNav.tsx        # Navigate between batch results
      BilingualView.tsx          # Side-by-side original + translated
      ErrorMessage.tsx           # Error states
      LoadingSpinner.tsx         # Loading skeleton
      LegalPage.tsx              # Legal/privacy (stub)
      TagEditor.tsx              # Tag chip input (stub)
      LazyFallback.tsx           # Code-split loading fallback
    lib/
      parseUrl.ts                # YouTube URL → video ID
      formatTime.ts              # Seconds → timestamp strings
      mergeSegments.ts           # Raw → sentence → paragraph merging
      cleanText.ts               # Filler word removal (EXISTS, NOT WIRED to UI)
      detectSpeakers.ts          # Speaker label heuristics (EXISTS, NOT WIRED to UI)
      parseChapters.ts           # Chapter timestamp parsing (EXISTS)
      sanitizeFilename.ts        # Title → safe filename
      exportTxt.ts               # TXT export
      exportSrt.ts               # SRT export
      exportVtt.ts               # VTT export
      exportJson.ts              # JSON export
      exportCsv.ts               # CSV export
      exportMarkdown.ts          # Markdown export
      ai/
        providers.ts             # OpenAI, Anthropic, Google, Chrome AI provider implementations
        prompts.ts               # Prompt templates (6 MISSING — see ai_prompt_inventory)
      storage/
        history.ts               # chrome.storage recent history
        saved.ts                 # IndexedDB saved transcripts + highlights + notes
        preferences.ts           # chrome.storage user preferences
      batch/
        queue.ts                 # Sequential batch processing with progress
    types/
      transcript.ts              # Shared types
      messages.ts                # Extension message protocol types
  dist/                          # Built extension — load as unpacked in Chrome
  manifest.json                  # MV3 manifest
  vite.config.ts
  package.json
```

## Build and Test

```bash
npm run dev          # Vite dev server (side panel only, no extension APIs)
npm run build        # Production build → dist/
npm run zip          # Build + zip for store submission
npm run lint         # tsc --noEmit (type check)
```

To test the extension: `npm run build` → Chrome → `chrome://extensions` → Developer mode →
"Load unpacked" → select `dist/` → open any YouTube video → click extension icon to open side panel.

## Gap Detail

Full per-gap implementation specs with files-to-modify and definition-of-done are in
`docs/runs/run-1to4-remaining.md`. Read it before starting work on any gap.

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

When the extension is published and verified on Chrome Web Store, Firefox Add-ons, or Edge Add-ons,
update the `yt-transcript` skill (`~/.claude/skills/yt-transcript/SKILL.md`) and
`AGENTS.md` with:

- Store listing URLs for each verified platform
- Install instructions (link to store instead of "Load unpacked")
- Badge/status indicating which stores are live
