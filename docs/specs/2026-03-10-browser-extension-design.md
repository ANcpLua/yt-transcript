# Design: YouTube Transcript Browser Extension

## Context

Replace the existing Cloudflare Pages web app with a Chrome/Edge browser extension. The extension uses Chrome's Side Panel API to host the full React app alongside YouTube pages. All Innertube API calls happen from the extension's background service worker using the user's IP — eliminating datacenter IP blocking and the need for a server-side proxy.

## Decisions

| Decision | Choice |
|----------|--------|
| UI Surface | Chrome Side Panel (MV3, Chrome 114+) |
| Project approach | Replace web app — extension only, delete `functions/` |
| AI strategy | Chrome AI (Summarizer/Language Detector) for basics + BYOK for advanced |
| Translations | YouTube `&tlang=` only (no Chrome Translator for transcripts) |
| Activation | Auto-detect YouTube videos, badge on icon, click to open panel |
| Architecture | Content script + Background service worker + Side panel (React) |
| Styling | Tailwind 4.0, CSS-first config, `@theme` tokens |
| Fonts | Plus Jakarta Sans + JetBrains Mono (bundled in extension) |
| Dark mode | Dark-first, `@custom-variant dark` |
| Permissions | YouTube/googlevideo required; AI provider hosts optional (requested at runtime) |
| Build | Vite + `@tailwindcss/vite` + CRXJS Vite Plugin |
| Distribution | Chrome Web Store + Edge Add-ons (same MV3 package) |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  YouTube Page (youtube.com/watch?v=XXX)                     │
│                                                             │
│  ┌─────────────────────────────────┐  ┌──────────────────┐ │
│  │  Content Script                 │  │  Chrome Side     │ │
│  │  • Detect video ID from URL     │  │  Panel           │ │
│  │  • Listen for SPA navigation    │──│                  │ │
│  │  • yt-navigate-finish event     │  │  React App       │ │
│  │  • Player state for seek/sync   │  │  (full features) │ │
│  └────────────┬────────────────────┘  └────────┬─────────┘ │
└───────────────┼────────────────────────────────┼───────────┘
                │ chrome.runtime.sendMessage      │
                ▼                                 │
┌───────────────────────────────────┐             │
│  Background Service Worker        │◄────────────┘
│  • Innertube API (user's IP)      │  chrome.runtime.sendMessage
│  • Chrome AI APIs (Summarizer,    │
│    Language Detector)             │
│  • BYOK AI proxy (OpenAI/etc)     │
│  • Message routing                │
└───────────────────────────────────┘
```

Three extension contexts communicating via typed messages:
- **Content script** — injected on YouTube pages, detects videos, relays player state (current time for seek/sync)
- **Service worker** — handles all network requests (Innertube, AI APIs)
- **Side panel** — React app with all UI features

## Project Structure

```
yt-transcript/
  manifest.json
  vite.config.ts
  package.json
  tsconfig.json
  src/
    sidepanel/
      index.html
      main.tsx
      App.tsx
    components/
      UrlInput.tsx
      TranscriptView.tsx
      ExportBar.tsx
      AiPanel.tsx
      Settings.tsx
      History.tsx
      SavedList.tsx
      BatchInput.tsx
      BatchProgress.tsx
      TagEditor.tsx
      LegalPage.tsx
      BatchResultsNav.tsx
      BilingualView.tsx
      LoadingSpinner.tsx
      ErrorMessage.tsx
    lib/
      parseUrl.ts
      parseChapters.ts
      formatTime.ts
      mergeSegments.ts
      cleanText.ts
      detectSpeakers.ts
      sanitizeFilename.ts
      exportTxt.ts
      exportSrt.ts
      exportVtt.ts
      exportJson.ts
      exportCsv.ts
      exportMarkdown.ts
      ai/
        providers.ts
        chrome-ai.ts
        prompts.ts
      storage/
        history.ts
        saved.ts
        preferences.ts
      batch/
        queue.ts
    types/
      transcript.ts
      messages.ts
    background/
      service-worker.ts
      innertube.ts
      innertube-browse.ts
    content/
      content.ts
    index.css
  public/
    icons/
      icon-16.png
      icon-48.png
      icon-128.png
    fonts/
      PlusJakartaSans-Variable.woff2
      JetBrainsMono-Variable.woff2
```

### What stays from current codebase
- All React components (adapted for panel width)
- All lib/ utilities (export, format, merge, clean, detect speakers, parseChapters)
- Types

### What gets deleted
- `functions/` directory (Cloudflare backend)
- `wrangler.toml`
- `tailwind.config.ts` / `tailwind.config.js`
- `postcss.config.js`
- Root `index.html`

### What gets added
- `manifest.json` (MV3)
- `src/background/service-worker.ts` — message routing, badge management
- `src/background/innertube.ts` — transcript fetching (consolidated from `functions/api/transcript.ts` + `functions/api/tracks.ts`), multi-client strategy (ANDROID → WEB → scrape fallback)
- `src/background/innertube-browse.ts` — playlist/channel fetching (consolidated from `functions/api/playlist.ts` + `functions/api/channel.ts`)
- `src/content/content.ts` — video detection, player state relay
- `src/types/messages.ts` — typed message protocol
- `src/lib/ai/chrome-ai.ts` — Chrome Summarizer/Language Detector wrapper
- `src/sidepanel/index.html` + `main.tsx`
- Extension icons (16, 48, 128)
- Bundled fonts (Plus Jakarta Sans, JetBrains Mono)

### What gets adapted
- `App.tsx` — receives video ID from content script via message passing; removes YouTube IFrame embed (content script relays real player state instead)
- `AiPanel.tsx` — Chrome AI for summaries, BYOK for advanced features
- `Settings.tsx` — `chrome.storage.sync` for preferences, `chrome.storage.local` for API keys
- `storage/history.ts` — `chrome.storage.local` instead of localStorage
- `storage/preferences.ts` — `chrome.storage.sync`
- `storage/saved.ts` — IndexedDB still works in extension context

## Manifest

```json
{
  "manifest_version": 3,
  "name": "YouTube Transcript Extractor",
  "description": "Extract, search, and export YouTube transcripts. Free. No signup.",
  "version": "1.0.0",
  "permissions": [
    "sidePanel",
    "activeTab",
    "storage",
    "webNavigation"
  ],
  "host_permissions": [
    "*://*.youtube.com/*",
    "*://*.googlevideo.com/*"
  ],
  "optional_host_permissions": [
    "*://api.openai.com/*",
    "*://api.anthropic.com/*",
    "*://generativelanguage.googleapis.com/*",
    "http://localhost:*/*"
  ],
  "side_panel": {
    "default_path": "sidepanel/index.html"
  },
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": [
        "*://*.youtube.com/watch*",
        "*://*.youtube.com/shorts/*",
        "*://*.youtube.com/embed/*",
        "*://*.youtube.com/live/*"
      ],
      "js": ["content/content.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

Key decisions:
- YouTube + googlevideo.com as required host permissions (Innertube + timedtext URLs)
- `webNavigation` permission for `onHistoryStateUpdated` backup listener
- AI provider hosts as optional permissions (requested at runtime when BYOK configured)
- `localhost` optional for Ollama local LLM
- Content script on watch, shorts, embed, and live pages

## Message Protocol

```typescript
// src/types/messages.ts

// Content script → Background
type VideoDetected = { type: "video-detected"; videoId: string };
type PlayerTime = { type: "player-time"; currentTime: number };

// Side panel → Background
type FetchTranscript = {
  type: "fetch-transcript";
  videoId: string;
  lang?: string;
  translateTo?: string;
};

type FetchTracks = { type: "fetch-tracks"; videoId: string };

type FetchPlaylist = { type: "fetch-playlist"; playlistId: string };
type FetchChannel = { type: "fetch-channel"; identifier: string };
// identifier: "@handle", "UCxxxxx", or channel name — innertube-browse resolves

type AiRequest = {
  type: "ai-request";
  feature: string;
  text: string;
  provider: "chrome-ai" | "openai" | "anthropic" | "google";
  config?: { apiKey: string; model: string; endpoint: string };
};

// Side panel → Content script (via background relay)
type SeekTo = { type: "seek-to"; time: number };

// Background → Side panel
type TranscriptResult =
  | { type: "transcript-result"; data: TranscriptResponse }
  | { type: "transcript-error"; error: ApiError };

type TracksResult =
  | { type: "tracks-result"; tracks: Track[]; title: string }
  | { type: "tracks-error"; error: ApiError };

type PlaylistResult =
  | { type: "playlist-result"; data: PlaylistResponse }
  | { type: "playlist-error"; error: string };

type ChannelResult =
  | { type: "channel-result"; data: ChannelResponse }
  | { type: "channel-error"; error: string };

type AiResult =
  | { type: "ai-result"; content: string }
  | { type: "ai-error"; error: string };

type VideoInfo = { type: "video-info"; videoId: string };
```

All network requests go through the background service worker. The side panel never calls YouTube directly.

## Content Script Behavior

Injected on `youtube.com/watch*`, `shorts/*`, `embed/*`, `live/*`:

1. Parse video ID from `window.location.href`
2. Send `video-detected` message to background
3. Listen for YouTube SPA navigation via `yt-navigate-finish` custom event
4. On navigation, re-parse and send updated video ID
5. Backup: `chrome.webNavigation.onHistoryStateUpdated` listener in background service worker
6. **Player integration**: poll `document.querySelector('video')?.currentTime` and send `player-time` messages (throttled to 1Hz) for active segment tracking and seek sync
7. Handle `seek-to` messages from side panel by setting `video.currentTime`

The content script is lightweight — no React, no UI injection. Video detection + player state relay.

## Background Service Worker

### Innertube code migration

The four Cloudflare Functions files consolidate into two background modules:

| Source (deleted) | Target | Contents |
|---|---|---|
| `functions/api/transcript.ts` | `src/background/innertube.ts` | Multi-client fetch (ANDROID → WEB → scrape), segment parsing, chapter extraction |
| `functions/api/tracks.ts` | `src/background/innertube.ts` | Track listing (shares player response) |
| `functions/api/playlist.ts` | `src/background/innertube-browse.ts` | Playlist video list via Innertube browse |
| `functions/api/channel.ts` | `src/background/innertube-browse.ts` | Channel recent videos via Innertube browse |
| `functions/_shared/innertube.ts` | `src/background/innertube.ts` | Client configs (ANDROID, WEB), shared constants |

The Cloudflare-specific `Response` / `PagesFunction` wrappers are removed. Functions return plain objects instead.

### Service worker lifecycle

MV3 service workers are ephemeral (terminated after ~30s of inactivity). Mitigations:
- `chrome.runtime.onMessage` keeps the worker alive while a response is pending (return `true` from listener)
- For long AI requests: the service worker stays alive as long as the fetch Promise is pending
- If an AI request exceeds 5 minutes, use `chrome.offscreen` API to create an offscreen document that handles the long-running fetch

## AI Strategy

### Chrome AI (free, no config, Chrome 138+)
- **Summarizer API** — basic transcript summaries
- **Language Detector API** — auto-detect transcript language

Chrome AI is on-device via Gemini Nano. Not guaranteed available — requires model download and sufficient hardware. Detection strategy:
1. Check `self.ai?.summarizer` existence
2. Call `ai.summarizer.capabilities()` → check `available` field
3. If `"after-download"`, prompt user to download model
4. If `"no"`, skip Chrome AI and fall back to BYOK

**Not using Chrome Translator API for transcripts.** Transcript translation stays on YouTube's `&tlang=` parameter per project constraint. Chrome AI Language Detector is used only to auto-detect language when the track metadata is ambiguous.

### BYOK (advanced features)
- OpenAI, Anthropic, Google providers
- **API keys stored in `chrome.storage.local`** (never synced to Google's servers)
- Advanced features: chat with transcript, flashcards, quotes, key points, blog outline, social posts, study notes, SEO keywords, entity extraction
- API calls made from background service worker (extension context has no CORS restrictions for permitted hosts)
- Optional host permissions requested when user first configures a provider

### Fallback order
1. Chrome AI if available and feature is supported (summary, language detection)
2. BYOK if configured
3. Show "Configure AI provider" prompt for advanced features

## Tailwind 4.0

### Package setup
```bash
npm i -D tailwindcss @tailwindcss/vite @tailwindcss/forms
```

### vite.config.ts
Uses CRXJS Vite Plugin for Chrome extension builds:
```ts
import { crx } from "@crxjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    crx({ manifest }),
  ],
});
```

CRXJS handles:
- Multiple entry points (side panel, content script, service worker) with correct output formats
- IIFE wrapping for content script (no ES module support in content scripts)
- ES module output for service worker
- React + HMR for side panel during development
- Manifest processing (resolves paths, copies assets)
- `dist/` output is a loadable extension directory

If CRXJS has compatibility issues with Tailwind 4 or current Vite version, fallback to manual `build.rollupOptions.input` with separate builds for each entry point.

### src/index.css
```css
@import "tailwindcss";
@plugin "@tailwindcss/forms";

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --font-sans: "Plus Jakarta Sans", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --color-panel: #0C1221;
  --color-surface: #111827;
  --color-elevated: #1E293B;
  --color-accent: #3B82F6;
  --color-success: #22C55E;
  --color-chapter: #F59E0B;
}

@utility scrollbar-hide {
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}
```

### Key v3 → v4 migration
- `@tailwind base/components/utilities` → `@import "tailwindcss"`
- `tailwind.config.ts` → `@theme {}` in CSS (delete config file)
- `postcss.config.js` → `@tailwindcss/vite` plugin (delete postcss config)
- `@layer utilities {}` → `@utility name {}`
- `darkMode: 'class'` → `@custom-variant dark`
- `shadow-sm` → `shadow-xs`, `shadow` → `shadow-sm`
- `rounded-sm` → `rounded-xs`, `rounded` → `rounded-sm`
- `outline-none` → `outline-hidden`
- `ring` → `ring-1` (default width changed from 3px to 1px)
- `bg-opacity-*` → `bg-color/opacity` syntax
- `!flex` → `flex!`
- `bg-[--var]` → `bg-(--var)`
- Existing `@layer base {}` and `@layer components {}` custom CSS blocks (`search-highlight`, `segment-active`, `segment-selected`) migrate to `@utility` blocks or plain CSS after `@import "tailwindcss"`
- Run `npx @tailwindcss/upgrade` to automate most renames

## Visual Design

- Dark-first (matches YouTube dark mode)
- Compact density for side panel: 12px body minimum, 10px timestamps (WCAG-safe)
- Plus Jakarta Sans (body/headings) + JetBrains Mono (timestamps)
- Blue accent (#3B82F6) for active segments and interactive elements
- Amber (#F59E0B) for chapter dividers
- Green badge (#22C55E) signals transcript availability
- Bottom bar with quick export buttons always visible
- Active segment tracking via content script player state relay: blue left border + subtle background as video plays
- Click timestamp in side panel → `seek-to` message → content script sets `video.currentTime`

## Build System

```bash
npm run dev        # Vite dev with HMR for side panel (CRXJS dev mode)
npm run build      # Production build → dist/ (loadable extension directory)
npm run zip        # Build + zip for store submission
```

CRXJS produces a complete `dist/` directory:
- `dist/sidepanel/index.html` + JS/CSS chunks
- `dist/content/content.js` (IIFE, no imports)
- `dist/background/service-worker.js` (ES module)
- `dist/manifest.json` (processed, paths resolved)
- `dist/icons/` + `dist/fonts/`

Load in Chrome via `chrome://extensions` → "Load unpacked" → select `dist/`.

## Storage

| Data | Web app (old) | Extension |
|------|--------------|-----------|
| Preferences | localStorage | `chrome.storage.sync` (syncs across devices) |
| History | localStorage | `chrome.storage.local` |
| Saved transcripts | IndexedDB | IndexedDB (works in extension context) |
| BYOK API keys | localStorage | `chrome.storage.local` (never synced) |

Note: `chrome.storage.sync` has 102KB total quota, 8KB per item. Preferences fit easily. API keys use `chrome.storage.local` (10MB quota) to avoid syncing secrets through Google's servers.

## Distribution

- **Chrome Web Store**: MV3 package, $5 one-time developer fee
- **Edge Add-ons**: same CRX package, Microsoft Partner Center account
- Both stores accept the same extension package
- Review timeline: 2-5 days (Chrome), up to 7 days (Edge)
- No remotely hosted code — all JS bundled in extension package
