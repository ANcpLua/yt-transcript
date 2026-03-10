# YouTube Transcript Browser Extension — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Cloudflare Pages web app with a Chrome/Edge MV3 browser extension using the Side Panel API.

**Architecture:** Content script detects YouTube videos and relays player state. Background service worker handles Innertube API calls and AI. Side panel hosts the full React app. All communication via typed chrome.runtime messages.

**Tech Stack:** React 19, TypeScript, Tailwind 4.x, Vite 6, esbuild, Chrome Extension MV3 APIs

**Spec:** `docs/specs/2026-03-10-browser-extension-design.md`

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `manifest.json` | MV3 extension manifest |
| `src/types/messages.ts` | Typed message protocol between contexts |
| `src/background/service-worker.ts` | Message routing, badge management, AI dispatch |
| `src/background/innertube.ts` | Transcript + track fetching (ANDROID → WEB → scrape) |
| `src/background/innertube-browse.ts` | Playlist + channel fetching |
| `src/content/content.ts` | YouTube video detection + player state relay |
| `src/lib/ai/chrome-ai.ts` | Chrome built-in Summarizer/Language Detector wrapper |
| `src/sidepanel/index.html` | Side panel HTML shell |
| `src/sidepanel/main.tsx` | React mount for side panel |
| `scripts/build.mjs` | Multi-target build script (sidepanel + worker + content) |

### Modified files
| File | Change |
|------|--------|
| `src/sidepanel/App.tsx` | Renamed from `src/App.tsx`. Replace `fetch("/api/...")` with `chrome.runtime.sendMessage`. Receive video ID from content script. Remove YouTube IFrame embed. |
| `src/lib/storage/preferences.ts` | `localStorage` → `chrome.storage.sync` |
| `src/lib/storage/history.ts` | `localStorage` → `chrome.storage.local` |
| `src/lib/ai/providers.ts` | Add `chrome-ai` provider case. Remove `anthropic-dangerous-direct-browser-access` header (not needed from extension context). |
| `src/components/AiPanel.tsx` | Show Chrome AI option when available. Fallback order. |
| `src/components/Settings.tsx` | Use chrome.storage for API keys (local, not sync). |
| `src/index.css` | Add `@theme` tokens, migrate `@layer` to `@utility` |
| `package.json` | Remove `@cloudflare/workers-types`, `wrangler`. Add `@types/chrome`. |
| `vite.config.ts` | Remove `/api` proxy. Single-target for sidepanel only. |
| `tsconfig.json` | Add `"types": ["chrome"]` |

### Deleted files
| File | Reason |
|------|--------|
| `functions/` (entire directory) | Replaced by background service worker |
| `wrangler.toml` | No Cloudflare |
| `tailwind.config.ts` | Content paths auto-detected in Tailwind 4 |
| `index.html` (root) | Replaced by `src/sidepanel/index.html` |

---

## Chunk 1: Foundation — Scaffold, Build, Manifest

### Task 1: Clean up old files and update dependencies

**Files:**
- Delete: `functions/`, `wrangler.toml`, `tailwind.config.ts`, `index.html`
- Modify: `package.json`, `tsconfig.json`

- [ ] **Step 1: Delete Cloudflare files**
```bash
rm -rf functions/ wrangler.toml tailwind.config.ts
```

- [ ] **Step 2: Move root index.html content aside (we'll reference it for sidepanel)**
```bash
mv index.html index.html.bak
```

- [ ] **Step 3: Update package.json**

Remove `@cloudflare/workers-types` and `wrangler` from devDependencies.
Add `@types/chrome`:
```bash
npm rm @cloudflare/workers-types wrangler
npm i -D @types/chrome
```

- [ ] **Step 4: Update tsconfig.json — add chrome types**

Add `"types": ["chrome"]` to `compilerOptions`. Remove `"include"` restriction if it only covers `src/` (content/background need to be included too — they're under `src/` so this is fine).

- [ ] **Step 5: Verify build still compiles (expect errors from missing /api fetch — that's expected)**
```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**
```
feat: remove Cloudflare backend, prepare for extension migration
```

---

### Task 2: Create manifest.json

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: Create manifest.json at project root**

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

- [ ] **Step 2: Create placeholder icons**
```bash
mkdir -p public/icons
# Generate simple colored squares as placeholders (replace with real icons later)
```
Use any 16x16, 48x48, 128x128 PNG. Can be generated with ImageMagick or a simple canvas script. Blue square with white "T" letter is fine for dev.

- [ ] **Step 3: Commit**
```
feat: add MV3 extension manifest
```

---

### Task 3: Create message types

**Files:**
- Create: `src/types/messages.ts`

- [ ] **Step 1: Create typed message protocol**

```typescript
// src/types/messages.ts
import type { TranscriptResponse, ApiError, Track } from "./transcript";

// ── Content script → Background ──

export interface VideoDetectedMessage {
  type: "video-detected";
  videoId: string;
}

export interface PlayerTimeMessage {
  type: "player-time";
  currentTime: number;
}

// ── Side panel → Background ──

export interface FetchTranscriptMessage {
  type: "fetch-transcript";
  videoId: string;
  lang?: string;
  translateTo?: string;
}

export interface FetchTracksMessage {
  type: "fetch-tracks";
  videoId: string;
}

export interface FetchPlaylistMessage {
  type: "fetch-playlist";
  playlistId: string;
}

export interface FetchChannelMessage {
  type: "fetch-channel";
  identifier: string;
}

export interface AiRequestMessage {
  type: "ai-request";
  feature: string;
  text: string;
  provider: "chrome-ai" | "openai" | "anthropic" | "google";
  config?: { apiKey: string; model: string; endpoint: string };
}

export interface SeekToMessage {
  type: "seek-to";
  time: number;
}

// ── Background → Side panel ──

export interface TranscriptResultMessage {
  type: "transcript-result";
  data: TranscriptResponse;
}

export interface TranscriptErrorMessage {
  type: "transcript-error";
  error: ApiError;
}

export interface TracksResultMessage {
  type: "tracks-result";
  tracks: Track[];
  title: string;
}

export interface TracksErrorMessage {
  type: "tracks-error";
  error: ApiError;
}

export interface VideoInfoMessage {
  type: "video-info";
  videoId: string;
}

export interface AiResultMessage {
  type: "ai-result";
  content: string;
}

export interface AiErrorMessage {
  type: "ai-error";
  error: string;
}

// ── Union types ──

export type ContentToBackgroundMessage =
  | VideoDetectedMessage
  | PlayerTimeMessage;

export type PanelToBackgroundMessage =
  | FetchTranscriptMessage
  | FetchTracksMessage
  | FetchPlaylistMessage
  | FetchChannelMessage
  | AiRequestMessage;

export type BackgroundToPanelMessage =
  | TranscriptResultMessage
  | TranscriptErrorMessage
  | TracksResultMessage
  | TracksErrorMessage
  | VideoInfoMessage
  | AiResultMessage
  | AiErrorMessage;

export type BackgroundToContentMessage =
  | SeekToMessage;

export type ExtensionMessage =
  | ContentToBackgroundMessage
  | PanelToBackgroundMessage
  | BackgroundToPanelMessage
  | BackgroundToContentMessage;
```

- [ ] **Step 2: Verify types compile**
```bash
npx tsc --noEmit src/types/messages.ts
```

- [ ] **Step 3: Commit**
```
feat: add typed message protocol for extension contexts
```

---

### Task 4: Create sidepanel entry point

**Files:**
- Create: `src/sidepanel/index.html`, `src/sidepanel/main.tsx`
- Move: `src/App.tsx` → `src/sidepanel/App.tsx` (placeholder — actual adaptation in Chunk 4)

- [ ] **Step 1: Create sidepanel/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YouTube Transcript</title>
</head>
<body class="dark bg-slate-900 text-slate-100">
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: Create sidepanel/main.tsx**

```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "../index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: Move App.tsx**
```bash
mv src/App.tsx src/sidepanel/App.tsx
```

- [ ] **Step 4: Delete old main.tsx and index.html.bak**
```bash
rm src/main.tsx index.html.bak
```

- [ ] **Step 5: Update vite.config.ts for sidepanel build**

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/sidepanel",
  build: {
    outDir: resolve(__dirname, "dist/sidepanel"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
```

- [ ] **Step 6: Commit**
```
refactor: create sidepanel entry point, move App.tsx
```

---

### Task 5: Create build script

**Files:**
- Create: `scripts/build.mjs`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Create scripts/build.mjs**

This script builds all three extension targets:

```javascript
// scripts/build.mjs
import { execSync } from "child_process";
import { cpSync, mkdirSync, existsSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

// Clean
if (existsSync(dist)) rmSync(dist, { recursive: true });
mkdirSync(dist, { recursive: true });

// 1. Side panel (Vite React build)
run("npx vite build");

// 2. Background service worker (esbuild, ESM)
mkdirSync(resolve(dist, "background"), { recursive: true });
run(
  `npx esbuild src/background/service-worker.ts ` +
  `--bundle --format=esm --target=es2022 ` +
  `--outfile=dist/background/service-worker.js`
);

// 3. Content script (esbuild, IIFE — no ES modules in content scripts)
mkdirSync(resolve(dist, "content"), { recursive: true });
run(
  `npx esbuild src/content/content.ts ` +
  `--bundle --format=iife --target=es2022 ` +
  `--outfile=dist/content/content.js`
);

// 4. Copy static assets
cpSync(resolve(root, "manifest.json"), resolve(dist, "manifest.json"));
cpSync(resolve(root, "public/icons"), resolve(dist, "icons"), { recursive: true });

if (existsSync(resolve(root, "public/fonts"))) {
  cpSync(resolve(root, "public/fonts"), resolve(dist, "fonts"), { recursive: true });
}

console.log("\n✅ Extension built to dist/");
```

- [ ] **Step 2: Update package.json scripts**

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "tsc -b && node scripts/build.mjs",
    "zip": "node scripts/build.mjs && cd dist && zip -r ../extension.zip ."
  }
}
```

- [ ] **Step 3: Add esbuild as dev dependency**
```bash
npm i -D esbuild
```

- [ ] **Step 4: Commit**
```
feat: add multi-target extension build script
```

---

### Task 6: Migrate index.css to Tailwind 4 patterns

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Update index.css**

Replace `@layer base/components` with `@theme` tokens and `@utility` blocks:

```css
@import "tailwindcss";

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

/* Base styles */
html {
  scroll-behavior: smooth;
  -webkit-text-size-adjust: 100%;
}

body {
  min-height: 100dvh;
}

::selection {
  background-color: var(--color-accent);
  color: white;
}

/* Custom utilities */
@utility search-highlight {
  background-color: #fbbf24;
  color: #1e293b;
  border-radius: 2px;
  padding: 0 1px;
}

@utility segment-active {
  background-color: #eff6ff;
  border-left: 3px solid var(--color-accent);
}

@utility segment-selected {
  background-color: #dbeafe;
}

@utility scrollbar-hide {
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Note: dark mode variants for search-highlight, segment-active, segment-selected will be handled by Tailwind's `dark:` variant in the component classes rather than in CSS utilities.

- [ ] **Step 2: Verify CSS compiles**
```bash
npx vite build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**
```
refactor: migrate CSS to Tailwind 4 @theme and @utility patterns
```

---

## Chunk 2: Background Service Worker — Innertube Migration

### Task 7: Create innertube.ts (transcript + tracks)

**Files:**
- Create: `src/background/innertube.ts`
- Reference: `functions/api/transcript.ts` (429 lines), `functions/api/tracks.ts` (61 lines), `functions/_shared/innertube.ts` (102 lines)

This consolidates the Cloudflare Functions into a single module. Returns plain objects instead of `Response`.

- [ ] **Step 1: Create src/background/innertube.ts**

Port the following from `functions/`:
- `INNERTUBE_PLAYER_URL`, `PLAYER_CLIENTS` (ANDROID + WEB configs) from `_shared/innertube.ts`
- `tryInnertubeClients()` from `transcript.ts` — multi-client fallback
- `scrapeWatchPage()` from `transcript.ts` — HTML fallback
- `extractPlayerResult()` from `transcript.ts` — response parsing
- `parseSegments()`, `parseChaptersFromDescription()` from `transcript.ts`
- Track listing from `tracks.ts`

Key changes from Cloudflare version:
- Functions return `TranscriptResponse | ApiError` instead of `new Response()`
- No `PagesFunction<Env>` types
- No `onRequestPost` exports
- Use standard `fetch()` (available in service worker)

The module exports two functions:
```typescript
export async function fetchTranscript(
  videoId: string,
  lang?: string,
  translateTo?: string,
): Promise<TranscriptResponse | ApiError> { ... }

export async function fetchTracks(
  videoId: string,
): Promise<{ tracks: Track[]; title: string } | ApiError> { ... }
```

- [ ] **Step 2: Verify types compile**
```bash
npx tsc --noEmit src/background/innertube.ts
```

- [ ] **Step 3: Commit**
```
feat: port Innertube transcript/track fetching to extension module
```

---

### Task 8: Create innertube-browse.ts (playlist + channel)

**Files:**
- Create: `src/background/innertube-browse.ts`
- Reference: `functions/api/playlist.ts` (95 lines), `functions/api/channel.ts` (113 lines)

- [ ] **Step 1: Create src/background/innertube-browse.ts**

Port from `functions/api/`:
- Playlist fetching with `VL` prefix + Innertube browse
- Channel fetching with handle resolution
- Pagination support

Exports:
```typescript
export async function fetchPlaylist(
  playlistId: string,
): Promise<{ playlistTitle: string; videos: VideoItem[] } | { error: string }> { ... }

export async function fetchChannel(
  identifier: string,
): Promise<{ channelTitle: string; videos: VideoItem[] } | { error: string }> { ... }

interface VideoItem {
  videoId: string;
  title: string;
}
```

- [ ] **Step 2: Verify types compile**
```bash
npx tsc --noEmit src/background/innertube-browse.ts
```

- [ ] **Step 3: Commit**
```
feat: port Innertube playlist/channel browse to extension module
```

---

### Task 9: Create service-worker.ts (message routing)

**Files:**
- Create: `src/background/service-worker.ts`

- [ ] **Step 1: Create src/background/service-worker.ts**

```typescript
import { fetchTranscript, fetchTracks } from "./innertube";
import { fetchPlaylist, fetchChannel } from "./innertube-browse";
import type { ExtensionMessage } from "../types/messages";

// Badge management: show green badge when video detected
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  switch (message.type) {
    case "video-detected":
      // Set badge on the tab's action icon
      if (sender.tab?.id) {
        chrome.action.setBadgeText({ text: "1", tabId: sender.tab.id });
        chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId: sender.tab.id });
      }
      // Forward to side panel if open
      chrome.runtime.sendMessage({ type: "video-info", videoId: message.videoId }).catch(() => {});
      return false;

    case "player-time":
      // Forward to side panel
      chrome.runtime.sendMessage(message).catch(() => {});
      return false;

    case "fetch-transcript":
      fetchTranscript(message.videoId, message.lang, message.translateTo)
        .then((result) => {
          if ("error" in result) {
            sendResponse({ type: "transcript-error", error: result });
          } else {
            sendResponse({ type: "transcript-result", data: result });
          }
        });
      return true; // keep channel open for async

    case "fetch-tracks":
      fetchTracks(message.videoId)
        .then((result) => {
          if ("error" in result) {
            sendResponse({ type: "tracks-error", error: result });
          } else {
            sendResponse({ type: "tracks-result", ...result });
          }
        });
      return true;

    case "fetch-playlist":
      fetchPlaylist(message.playlistId)
        .then((result) => sendResponse(result));
      return true;

    case "fetch-channel":
      fetchChannel(message.identifier)
        .then((result) => sendResponse(result));
      return true;

    case "ai-request":
      handleAiRequest(message)
        .then((content) => sendResponse({ type: "ai-result", content }))
        .catch((err) => sendResponse({ type: "ai-error", error: String(err) }));
      return true;
  }
});

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Backup: detect YouTube navigation via webNavigation API
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    const url = new URL(details.url);
    const videoId = url.searchParams.get("v");
    if (videoId) {
      chrome.action.setBadgeText({ text: "1", tabId: details.tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId: details.tabId });
      chrome.runtime.sendMessage({ type: "video-info", videoId }).catch(() => {});
    }
  },
  { url: [{ hostSuffix: "youtube.com" }] },
);

async function handleAiRequest(message: ExtensionMessage & { type: "ai-request" }): Promise<string> {
  if (message.provider === "chrome-ai") {
    // Chrome built-in AI — import dynamically to avoid errors on older Chrome
    const { chromeAiSummarize } = await import("../lib/ai/chrome-ai");
    return chromeAiSummarize(message.text);
  }

  // BYOK providers — call directly from service worker (no CORS restrictions)
  const { getProvider } = await import("../lib/ai/providers");
  if (!message.config?.apiKey) throw new Error("No API key configured");
  const provider = getProvider(message.provider, message.config.apiKey);
  const { getPrompt } = await import("../lib/ai/prompts");
  const systemPrompt = getPrompt(message.feature);
  return provider.sendMessage({ systemPrompt, userMessage: message.text });
}
```

- [ ] **Step 2: Verify types compile**
```bash
npx tsc --noEmit src/background/service-worker.ts
```

- [ ] **Step 3: Commit**
```
feat: add extension service worker with message routing
```

---

## Chunk 3: Content Script

### Task 10: Create content.ts

**Files:**
- Create: `src/content/content.ts`

- [ ] **Step 1: Create src/content/content.ts**

```typescript
const VIDEO_ID_RE = /[?&]v=([a-zA-Z0-9_-]{11})/;
const SHORTS_RE = /\/shorts\/([a-zA-Z0-9_-]{11})/;
const EMBED_RE = /\/embed\/([a-zA-Z0-9_-]{11})/;
const LIVE_RE = /\/live\/([a-zA-Z0-9_-]{11})/;

let lastVideoId: string | null = null;
let playerTimeInterval: ReturnType<typeof setInterval> | null = null;

function extractVideoId(url: string): string | null {
  for (const re of [VIDEO_ID_RE, SHORTS_RE, EMBED_RE, LIVE_RE]) {
    const match = re.exec(url);
    if (match?.[1]) return match[1];
  }
  return null;
}

function detectAndNotify(): void {
  const videoId = extractVideoId(window.location.href);
  if (!videoId || videoId === lastVideoId) return;

  lastVideoId = videoId;
  chrome.runtime.sendMessage({ type: "video-detected", videoId });

  // Start player time relay (1Hz)
  if (playerTimeInterval) clearInterval(playerTimeInterval);
  playerTimeInterval = setInterval(() => {
    const video = document.querySelector("video");
    if (video && !video.paused) {
      chrome.runtime.sendMessage({
        type: "player-time",
        currentTime: video.currentTime,
      }).catch(() => {});
    }
  }, 1000);
}

// Initial detection
detectAndNotify();

// YouTube SPA navigation
document.addEventListener("yt-navigate-finish", () => detectAndNotify());

// Handle seek-to messages from side panel
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "seek-to") {
    const video = document.querySelector("video");
    if (video) video.currentTime = message.time;
  }
});
```

- [ ] **Step 2: Verify types compile**
```bash
npx tsc --noEmit src/content/content.ts
```

- [ ] **Step 3: Commit**
```
feat: add content script for YouTube video detection and player sync
```

---

## Chunk 4: React App Adaptation

### Task 11: Adapt App.tsx for extension messaging

**Files:**
- Modify: `src/sidepanel/App.tsx`

This is the largest change. Replace all `fetch("/api/...")` calls with `chrome.runtime.sendMessage`.

- [ ] **Step 1: Replace fetchTranscript function**

Find the `fetchTranscript` callback (currently uses `fetch("/api/transcript", ...)`).
Replace with:

```typescript
const fetchTranscript = useCallback(async (videoId: string, lang?: string, translateTo?: string) => {
  const now = Date.now();
  if (now - lastFetchRef.current < 2000) return;
  lastFetchRef.current = now;

  setState("loading");
  setError(null);

  const response = await chrome.runtime.sendMessage({
    type: "fetch-transcript",
    videoId,
    ...(lang ? { lang } : {}),
    ...(translateTo ? { translateTo } : {}),
  });

  if (response.type === "transcript-error") {
    setError(response.error);
    setState("error");
    return;
  }

  setTranscript(response.data);
  setState("loaded");
  addToHistory({ videoId, title: response.data.title, /* ... */ });
}, []);
```

- [ ] **Step 2: Add listener for video-info messages from content script**

Add a `useEffect` that listens for `video-info` messages:

```typescript
useEffect(() => {
  const listener = (message: { type: string; videoId?: string }) => {
    if (message.type === "video-info" && message.videoId) {
      void fetchTranscript(message.videoId);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}, [fetchTranscript]);
```

- [ ] **Step 3: Add player time listener for active segment tracking**

Replace the YouTube IFrame Player API integration with:

```typescript
useEffect(() => {
  const listener = (message: { type: string; currentTime?: number }) => {
    if (message.type === "player-time" && message.currentTime !== undefined) {
      setCurrentTime(message.currentTime);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}, []);
```

- [ ] **Step 4: Replace playlist/channel fetch calls**

Find `fetch("/api/playlist?...")` and `fetch("/api/channel?...")` in UrlInput.tsx.
Replace with `chrome.runtime.sendMessage({ type: "fetch-playlist", playlistId })` and `chrome.runtime.sendMessage({ type: "fetch-channel", identifier })`.

- [ ] **Step 5: Remove YouTube IFrame embed component and related code**

Delete the `YouTubeEmbed` / IFrame Player API loading code from App.tsx. The content script now relays player state directly.

- [ ] **Step 6: Add seek-to handler**

When user clicks a timestamp in TranscriptView:
```typescript
const handleSeek = useCallback((time: number) => {
  chrome.runtime.sendMessage({ type: "seek-to", time });
}, []);
```

- [ ] **Step 7: Verify build compiles**
```bash
npx tsc --noEmit
```

- [ ] **Step 8: Commit**
```
refactor: adapt App.tsx for extension message-based communication
```

---

### Task 12: Adapt storage layer

**Files:**
- Modify: `src/lib/storage/preferences.ts`, `src/lib/storage/history.ts`

- [ ] **Step 1: Rewrite preferences.ts to use chrome.storage**

```typescript
const PREFS_KEY = "preferences";
const API_KEY_PREFIX = "apiKey:";

const DEFAULTS: Preferences = {
  viewMode: "raw",
  showTimestamps: true,
  compactMode: false,
  autoScroll: true,
  aiProvider: null,
};

export async function getPreferences(): Promise<Preferences> {
  const result = await chrome.storage.sync.get(PREFS_KEY);
  return result[PREFS_KEY] ? { ...DEFAULTS, ...result[PREFS_KEY] } : DEFAULTS;
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await chrome.storage.sync.set({ [PREFS_KEY]: prefs });
}

export async function getApiKey(provider: string): Promise<string | null> {
  const key = `${API_KEY_PREFIX}${provider}`;
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

export async function saveApiKey(provider: string, apiKey: string): Promise<void> {
  await chrome.storage.local.set({ [`${API_KEY_PREFIX}${provider}`]: apiKey });
}

export async function removeApiKey(provider: string): Promise<void> {
  await chrome.storage.local.remove(`${API_KEY_PREFIX}${provider}`);
}
```

**Note:** All functions are now `async`. Callers must be updated to `await`.

- [ ] **Step 2: Rewrite history.ts to use chrome.storage.local**

```typescript
const STORAGE_KEY = "history";
const MAX_ENTRIES = 50;

export async function getHistory(): Promise<HistoryEntry[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] ?? [];
}

export async function addToHistory(entry: HistoryEntry): Promise<void> {
  const entries = (await getHistory()).filter((e) => e.videoId !== entry.videoId);
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  await chrome.storage.local.set({ [STORAGE_KEY]: entries });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
```

- [ ] **Step 3: Update all callers to use async/await**

Components that call `getPreferences()`, `getHistory()`, `getApiKey()` need to be updated from synchronous to async. Key files:
- `Settings.tsx` — `getApiKey()` and `saveApiKey()` calls
- `History.tsx` — `getHistory()` call
- `App.tsx` — `addToHistory()` and `getPreferences()` calls

- [ ] **Step 4: Verify build compiles**
```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**
```
refactor: migrate storage from localStorage to chrome.storage APIs
```

---

### Task 13: Create chrome-ai.ts wrapper

**Files:**
- Create: `src/lib/ai/chrome-ai.ts`

- [ ] **Step 1: Create Chrome AI wrapper**

```typescript
// src/lib/ai/chrome-ai.ts

export async function isChromeAiAvailable(): Promise<boolean> {
  try {
    if (!("ai" in self) || !(self as any).ai?.summarizer) return false;
    const caps = await (self as any).ai.summarizer.capabilities();
    return caps.available === "readily" || caps.available === "after-download";
  } catch {
    return false;
  }
}

export async function chromeAiSummarize(text: string): Promise<string> {
  const ai = (self as any).ai;
  if (!ai?.summarizer) throw new Error("Chrome AI Summarizer not available");

  const caps = await ai.summarizer.capabilities();
  if (caps.available === "no") throw new Error("Summarizer not supported on this device");

  const summarizer = await ai.summarizer.create({
    type: "key-points",
    length: "medium",
  });

  try {
    return await summarizer.summarize(text);
  } finally {
    summarizer.destroy();
  }
}

export async function chromeAiDetectLanguage(text: string): Promise<string | null> {
  const ai = (self as any).ai;
  if (!ai?.languageDetector) return null;

  const detector = await ai.languageDetector.create();
  try {
    const results = await detector.detect(text);
    return results[0]?.detectedLanguage ?? null;
  } finally {
    detector.destroy();
  }
}
```

Note: `(self as any).ai` is used because Chrome AI type definitions are not yet in `@types/chrome`. When they are, replace with proper types.

- [ ] **Step 2: Add chrome-ai provider to providers.ts**

Add a `"chrome-ai"` case to `getProvider()`:
```typescript
case "chrome-ai":
  return {
    name: "chrome-ai",
    async sendMessage({ userMessage }) {
      const { chromeAiSummarize } = await import("./chrome-ai");
      return chromeAiSummarize(userMessage);
    },
    async validateKey() { return true; },
  };
```

- [ ] **Step 3: Commit**
```
feat: add Chrome built-in AI (Summarizer, Language Detector) wrapper
```

---

### Task 14: Adapt AiPanel and Settings for Chrome AI

**Files:**
- Modify: `src/components/AiPanel.tsx`, `src/components/Settings.tsx`

- [ ] **Step 1: AiPanel.tsx — show Chrome AI option**

Add a check for Chrome AI availability. When available, show "Chrome AI (Free)" as default option for summary. Advanced features (chat, flashcards, etc.) still require BYOK.

- [ ] **Step 2: Settings.tsx — update API key storage calls**

Change `getApiKey()`/`saveApiKey()` calls from synchronous to async. Use `chrome.storage.local` (already done in Task 12).

- [ ] **Step 3: Remove `anthropic-dangerous-direct-browser-access` header**

In `providers.ts`, the Anthropic provider has this header for browser CORS. Extension context doesn't need it — remove it.

- [ ] **Step 4: Commit**
```
feat: integrate Chrome AI into AI panel with BYOK fallback
```

---

## Chunk 5: Build, Test, Polish

### Task 15: Run Tailwind v3→v4 utility migration on components

**Files:**
- Modify: all `src/components/*.tsx`

- [ ] **Step 1: Run the automated upgrade tool**
```bash
npx @tailwindcss/upgrade
```

This renames utilities across all component files:
- `shadow-sm` → `shadow-xs`
- `shadow` → `shadow-sm`
- `rounded-sm` → `rounded-xs`
- `rounded` → `rounded-sm`
- `outline-none` → `outline-hidden`
- `ring` → `ring-1`
- etc.

- [ ] **Step 2: Manual review — check for any missed patterns**

Grep for known v3 patterns that the tool might miss:
```bash
grep -rn "bg-opacity-\|text-opacity-\|!important\|bg-\[--" src/components/
```

- [ ] **Step 3: Verify build**
```bash
npm run build
```

- [ ] **Step 4: Commit**
```
refactor: migrate all component utilities to Tailwind v4 syntax
```

---

### Task 16: Build and load extension in Chrome

- [ ] **Step 1: Full build**
```bash
npm run build
```
Expected: `dist/` directory with `sidepanel/`, `background/`, `content/`, `manifest.json`, `icons/`

- [ ] **Step 2: Load unpacked in Chrome**
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist/` directory
5. Verify extension appears with correct name and icon

- [ ] **Step 3: Navigate to a YouTube video**
1. Go to `youtube.com/watch?v=dQw4w9WgXcQ`
2. Verify green badge appears on extension icon
3. Click extension icon → side panel should open
4. Transcript should auto-load

- [ ] **Step 4: Test core features**
- Search within transcript
- Click timestamp → video seeks
- Export as TXT, SRT
- Copy all
- Switch language track
- Test playlist URL detection

- [ ] **Step 5: Fix any issues found**

- [ ] **Step 6: Commit**
```
feat: verified working Chrome extension build
```

---

### Task 17: Bundle fonts

**Files:**
- Create: `public/fonts/PlusJakartaSans-Variable.woff2`, `public/fonts/JetBrainsMono-Variable.woff2`
- Modify: `src/index.css`

- [ ] **Step 1: Download font files**

Download from Google Fonts or GitHub releases:
- Plus Jakarta Sans Variable: `https://github.com/nicholasgross/plus-jakarta-sans/releases`
- JetBrains Mono Variable: `https://github.com/JetBrains/JetBrainsMono/releases`

Place woff2 files in `public/fonts/`.

- [ ] **Step 2: Add @font-face declarations to index.css**

Add before `@import "tailwindcss"`:
```css
@font-face {
  font-family: "Plus Jakarta Sans";
  src: url("/fonts/PlusJakartaSans-Variable.woff2") format("woff2");
  font-weight: 200 800;
  font-display: swap;
}

@font-face {
  font-family: "JetBrains Mono";
  src: url("/fonts/JetBrainsMono-Variable.woff2") format("woff2");
  font-weight: 100 800;
  font-display: swap;
}
```

- [ ] **Step 3: Rebuild and verify fonts load**
```bash
npm run build
```

- [ ] **Step 4: Commit**
```
feat: bundle custom fonts for extension
```

---

## Dependency Graph

```
Task 1 (cleanup) ──→ Task 2 (manifest) ──→ Task 5 (build script)
                 ──→ Task 3 (messages)  ──→ Task 9 (service worker) ──→ Task 11 (App.tsx)
                 ──→ Task 4 (sidepanel) ──→ Task 11 (App.tsx)
                                        ──→ Task 7 (innertube)     ──→ Task 9
                                        ──→ Task 8 (browse)        ──→ Task 9
                                        ──→ Task 10 (content)
                                        ──→ Task 12 (storage)      ──→ Task 14 (settings)
                                        ──→ Task 13 (chrome-ai)    ──→ Task 14
Task 15 (tailwind migration) — can run anytime after Task 4
Task 16 (build test) — after all other tasks
Task 17 (fonts) — independent, anytime

Parallelizable groups:
  Group A: Tasks 7, 8, 10, 12, 13 (independent modules)
  Group B: Tasks 9, 11, 14 (depend on Group A)
  Group C: Tasks 15, 16, 17 (polish)
```
