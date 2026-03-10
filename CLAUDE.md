# CLAUDE.md — YouTube Transcript Tool

## What this is

Free YouTube transcript extraction tool. Extract, read, search, export, and AI-analyze YouTube transcripts. Zero cost.
No accounts. No paid APIs. No tracking.

## Hard constraints

- **Zero recurring cost.** No server-side databases, no paid APIs, no cloud compute beyond Cloudflare free tier.
- **No accounts.** No signup, no login, no auth. Core features work immediately.
- **No tracking.** No analytics, no cookies, no telemetry. Network tab must show zero requests to tracking domains.
- **BYOK for AI.** User provides their own API key (OpenAI, Anthropic, or Google). Key stored in localStorage only.
  Never sent to our server. AI calls go browser → provider API directly.
- **Translations via YouTube.** Use YouTube's own auto-translate tracks (`&tlang=` parameter). No third-party
  translation API.

## Tech stack

```
Frontend:   Vite 8.3 + React + TypeScript + Tailwind CSS
Backend:    Cloudflare Pages Functions (co-located in /functions/api/)
Deploy:     Cloudflare Pages — single `wrangler pages deploy dist/` ships frontend + API
Node:       25.6.1
```

No separate Worker project. No separate deploy. The `functions/` directory is automatically picked up by Cloudflare
Pages as serverless functions.

## Project structure

```
yt-transcript/
  src/
    App.tsx
    main.tsx
    index.css                    # Tailwind directives
    components/
      UrlInput.tsx               # URL input + validation
      TranscriptView.tsx         # Transcript display, view modes, search, highlights
      ExportBar.tsx              # Copy + all download buttons
      ErrorMessage.tsx           # Error states
      LoadingSpinner.tsx         # Loading skeleton
      Settings.tsx               # BYOK API key management + preferences
      AiPanel.tsx                # AI features: summary, chat, quotes, etc.
      History.tsx                # Recent history panel
      SavedList.tsx              # Saved transcripts panel
      BatchInput.tsx             # Batch/playlist URL input
      BatchProgress.tsx          # Batch processing progress
      BilingualView.tsx          # Side-by-side original + translated
    lib/
      parseUrl.ts                # YouTube URL → video ID extraction
      formatTime.ts              # Seconds → MM:SS and HH:MM:SS,mmm
      mergeSegments.ts           # Raw → sentence → paragraph merging
      cleanText.ts               # Filler word removal
      detectSpeakers.ts          # Speaker label heuristics
      sanitizeFilename.ts        # Title → safe filename
      exportTxt.ts               # TXT generation
      exportSrt.ts               # SRT generation
      exportVtt.ts               # VTT generation
      exportJson.ts              # JSON generation
      exportCsv.ts               # CSV generation
      exportMarkdown.ts          # Markdown generation
      ai/
        providers.ts             # OpenAI, Anthropic, Google provider implementations
        prompts.ts               # Prompt templates for each AI feature
      storage/
        history.ts               # localStorage recent history (50 entries)
        saved.ts                 # IndexedDB saved transcripts + highlights + notes
        preferences.ts           # localStorage user preferences
      batch/
        queue.ts                 # Sequential batch processing with progress
    types/
      transcript.ts              # Shared types used by frontend + functions
  functions/
    api/
      transcript.ts              # POST /api/transcript — Innertube proxy
      tracks.ts                  # GET /api/tracks — caption track list
      playlist.ts                # GET /api/playlist — playlist video list
      channel.ts                 # GET /api/channel — channel recent videos
  public/
    favicon.ico
  docs/
    runs/
      run-1-core-mvp.md
      run-2-reading-exports-languages.md
      run-3-ai-layer-persistence.md
      run-4-bulk-polish-ship.md
  index.html
  vite.config.ts
  tsconfig.json
  tailwind.config.ts
  package.json
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (React SPA)                                │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ URL Input    │→ │ Transcript   │→ │ Export    │ │
│  │ + Validation │  │ View + Search│  │ All fmts  │ │
│  └─────────────┘  └──────────────┘  └───────────┘ │
│         │                                    │      │
│         │              ┌─────────────────┐   │      │
│         │              │ AI Panel (BYOK) │   │      │
│         │              │ Browser → API   │   │      │
│         │              └────────┬────────┘   │      │
│         │                       │            │      │
│         │          ┌────────────▼──────────┐ │      │
│         │          │ localStorage/IndexedDB│ │      │
│         │          │ History, Saved, Prefs │ │      │
│         │          └───────────────────────┘ │      │
│         │                                    │      │
└─────────┼────────────────────────────────────┼──────┘
          │ /api/*                             │ Direct HTTPS
          ▼                                    ▼
┌─────────────────────┐          ┌──────────────────────┐
│ Cloudflare Pages     │          │ AI Provider APIs     │
│ Functions            │          │ (OpenAI / Anthropic  │
│                      │          │  / Google Gemini)    │
│ POST /api/transcript │          │                      │
│ GET  /api/tracks     │          │ User's own API key   │
│ GET  /api/playlist   │          │ Never touches our    │
│ GET  /api/channel    │          │ server               │
└──────────┬───────────┘          └──────────────────────┘
           │
           ▼
┌──────────────────────┐
│ YouTube Innertube API│
│ (undocumented)       │
│                      │
│ POST youtubei/v1/    │
│   player             │
│ GET timedtext        │
│   ?fmt=json3         │
│ POST youtubei/v1/    │
│   browse (playlists) │
└──────────────────────┘
```

## How the Innertube API works

This is the core of the product. YouTube has no public API for downloading third-party video captions. The official
YouTube Data API v3 `captions.download` requires OAuth and only works for videos the authenticated user owns. Every
transcript tool in the market uses YouTube's undocumented Innertube API instead.

### Step 1: Get caption tracks

```
POST https://www.youtube.com/youtubei/v1/player?prettyPrint=false
Headers:
  Content-Type: application/json
  User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...

Body:
{
  "context": {
    "client": {
      "clientName": "WEB",
      "clientVersion": "2.20240101.00.00"
    }
  },
  "videoId": "dQw4w9WgXcQ"
}
```

Response includes `captions.playerCaptionsTracklistRenderer.captionTracks[]`, each with:

- `baseUrl` — the URL to fetch that track's transcript
- `languageCode` — e.g., "en"
- `kind` — "asr" for auto-generated, absent for manual/uploaded
- `name.simpleText` — human-readable language name

### Step 2: Get transcript text

```
GET {baseUrl}&fmt=json3
```

For translation, append `&tlang={targetLangCode}` to the baseUrl.

Response:

```json
{
  "events": [
    {
      "tStartMs": 1500,
      "dDurationMs": 3000,
      "segs": [{ "utf8": "Hello " }, { "utf8": "world" }]
    }
  ]
}
```

Parse: concatenate all `segs[].utf8` per event. `tStartMs / 1000` = start seconds. Skip events with no `segs` (timing
markers).

### Step 3: Playlists / channels

```
POST https://www.youtube.com/youtubei/v1/browse
Body: { "context": { ... }, "browseId": "VLPLxxxxx" }  // VL prefix + playlist ID
```

Returns video list with IDs, titles, durations. Supports pagination via `continuationToken`.

### Known risks

- **No CORS headers** — Innertube responses have no `Access-Control-Allow-Origin`. Must proxy through server-side
  function. Browser cannot call directly.
- **IP blocking** — YouTube blocks known datacenter IPs. Cloudflare Workers' IPs may get blocked. If this happens,
  consider browser extension approach where requests come from user's IP.
- **PO Token** — Some videos require a `po_token` parameter. The `youtube-transcript-api` Python library (v1.2.4) raises
  `PoTokenRequired` for these. No general solution yet.
- **Breakage** — YouTube broke all HTML-scraping tools on ~June 9, 2025 by changing authentication. They can change the
  Innertube API at any time with no notice.
- **TOS violation** — Using undocumented APIs violates YouTube Developer Policy Section III.D.7. Every competitor does
  the same. Not a legal defense but establishes market norm.

## Shared types

```typescript
interface Segment {
  start: number;       // seconds (float)
  duration: number;    // seconds (float)
  text: string;
}

interface Track {
  languageCode: string;
  name: string;
  kind?: string;       // "asr" = auto-generated, absent = manual
}

interface TranscriptResponse {
  videoId: string;
  title: string;
  language: string;
  isAutoGenerated: boolean;
  tracks: Track[];
  segments: Segment[];
}

interface ApiError {
  error: "no_captions" | "invalid_id" | "unavailable" | "rate_limited" | "fetch_failed" | "invalid_request";
  message: string;
}
```

## Feature summary by run

### Run 1 — Core MVP

Paste URL → fetch transcript via Innertube proxy → display with timestamps → search → copy → download TXT/SRT. Error
handling. Responsive layout. Deploy.

### Run 2 — Reading + Exports + Languages

Paragraph/sentence/raw view modes. YouTube IFrame embed with click-to-seek + auto-scroll. VTT/JSON/CSV/Markdown export.
Range selection export. Language selection. YouTube auto-translate. Side-by-side bilingual view. Chapter-aware grouping.

### Run 3 — AI + Persistence

BYOK API key management (OpenAI, Anthropic, Google). Summary, key points, chapter summary, action items, quotes.
Ask-the-transcript chat with timestamp citations. localStorage history (50 entries). IndexedDB saved transcripts with
highlights, notes, tags. Preferences persistence.

### Run 4 — Bulk + Polish + Ship

Batch URL input (25 max). Playlist extraction. Channel recent videos. ZIP export (separate or merged). Blog outline,
social posts, study notes, flashcards, SEO keywords, entity extraction. Notion/Obsidian copy formats. Filler word
removal. Speaker labels. Accessibility audit (WCAG 2.1 AA). Virtual scroll for long transcripts. Code splitting. Legal
page. Production deploy.

## Competitive positioning

This tool is free with zero signup. Competitors gate behind credits or accounts:

- **youtube-transcript.io** — 25 free credits/month, then $9.99/mo
- **Glasp** — 3 AI summaries/day free, requires extension + account, then $12/mo
- **Tactiq** — 10 transcripts/month free, requires extension + account, then $12/mo
- **NoteGPT** — 15 quotas/month free, then $9.99/mo

We beat all of them on: no signup, no caps on extraction, all export formats free, bilingual view, BYOK AI (unlimited
with own key).

## Code style

- TypeScript strict mode
- React functional components with hooks
- Tailwind utility classes (no CSS modules, no styled-components)
- Named exports for components, default exports only for pages
- Explicit return types on exported functions
- Error states handled at component level (no global error boundary for user-facing errors)
- No `any` types — use `unknown` + type narrowing

## Build and deploy

```bash
# Development
npm run dev                              # Vite dev server (frontend only)
npx wrangler pages dev dist/             # Full stack with functions (after build)

# Build
npm run build                            # Vite production build → dist/

# Deploy
npx wrangler pages deploy dist/          # Ships frontend + /functions/* together

# Local testing of functions
npm run build && npx wrangler pages dev dist/ --live-reload
```

## Run checklists

Each run has a self-contained checklist at `docs/runs/run-{1-4}-*.md`. Each item has a definition of done. Start any
fresh session by reading the relevant run file. The run files contain all context needed to work independently.
