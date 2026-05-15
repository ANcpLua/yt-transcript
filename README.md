# YouTube Transcript Extractor

MV3 browser extension. Side panel UI. Source under `src/`.

## Status

Work in progress. The transcript-extraction pipeline does not currently
function end-to-end on a fresh install — pasting a YouTube URL produces an
`activeTab` / `captureVisibleTab` error before any captions are fetched.
See `AGENTS.md` for the architecture and the open feature table; do not
trust any prior "DONE" or "working" claim until it is reproduced by the
E2E harness under `e2e/`.

## Build from source

```bash
npm install
npm run build    # produces dist/
```

Load as unpacked extension in Chrome: `chrome://extensions` → Developer
mode → "Load unpacked" → select `dist/`. Reload any open YouTube tabs so
they pick up the freshly-built content scripts.

## Stack

React 19, Vite, Tailwind CSS 4, TypeScript (strict), MV3.
