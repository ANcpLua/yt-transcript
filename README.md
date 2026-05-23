# yt-transcript

MV3 browser extension for extracting, viewing, saving, and exporting YouTube
and Vimeo transcripts from a side panel.

## What Ships

- Side-panel React UI for a single transcript or a batch of YouTube videos.
- YouTube extraction through the background service worker and MAIN-world
  interception on watch pages.
- Vimeo extraction from the page player config.
- Batch transcript fetching with bounded parallelism: up to 4 YouTube videos
  are fetched at once.
- Export to TXT, SRT, VTT, JSON, CSV, and Markdown.
- Local history, saved transcripts, tags, highlights, and notes.
- Optional BYOK AI providers and Chrome built-in AI where available.
- Optional local Whisper transcription for videos without captions.

## Limits

- No backend, telemetry, accounts, or paid service dependency.
- Batch mode is YouTube-only.
- Some YouTube requests can still be blocked or throttled by YouTube; opening
  the video in a normal browser tab gives the extension its best capture path.
- Local Whisper requires the user to grant Hugging Face model-download
  permission and download model weights.

## Build

```bash
npm install
npm run build
```

Load `dist/` as an unpacked extension in Chrome. (The same build also loads on
Edge — both are Chromium with the MV3 surface we use — but we test and ship
only against Chrome.)

Release zip for the Chrome Web Store:

```bash
npm run zip
```

## Useful Checks

```bash
npm run lint
npm run build
```
