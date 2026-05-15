# YouTube Transcript Extractor

MV3 browser extension. Side panel UI. Source under `src/`.

## Status

The transcript-extraction pipeline has been repaired on
`fix/transcript-extraction-real` (PR #2) — auto-detect on a watch page
populates the side panel via the MAIN-world interceptor, and paste-URL
recovery from a non-YouTube tab now routes through the same correlator
instead of trying `chrome.tabCapture` against the wrong tab. The
verified-real-Chrome proof lives at
`e2e/screenshots/20260515T092700Z/03-after-success.png` +
`03-after-transcript.txt`. The Playwright harness still fails end-to-end
because YouTube bot-detects chrome-for-testing; treat it as a
path-regression guard and follow the manual procedure in `AGENTS.md`
("How to verify the extension actually works") for caption-content proof.

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
