# Video Transcript

A free Manifest V3 Chrome side-panel extension that discovers the transcript
already exposed by a media page and uses Chrome built-in AI only when no
readable timed text exists. No backend, accounts, API keys, telemetry, or paid
services.

## How extraction works

The primary path is platform-independent:

1. The user opens the extension on an active media tab.
2. Chrome grants temporary `activeTab` access for that page.
3. The extension inspects every accessible `<video>` and `<audio>` element,
   its `TextTrackList`, runtime cues, and child `<track>` elements.
4. A page-world observer checks already-loaded and future `fetch`/XHR resources
   against timed-text URL and MIME candidates. Text bodies are capped at 2 MiB.
5. WebVTT, SRT, TTML/DFXP, ASS/SSA, SAMI, SBV, LRC, and common JSON cue shapes
   are normalized into one transcript model. HLS and DASH manifests are
   expanded to discover subtitle resources.
6. If the page has no readable timed text, the UI offers explicit live-audio
   transcription through Chrome's on-device Prompt API.

No static content script runs on every site, and there is no permanent
all-sites host permission. Cross-origin players and caption CDNs are handled
through a user-visible optional permission prompt for only the detected
origins.

A narrowly scoped page adapter remains for a source whose authenticated caption
responses require site-specific handling. It is injected only after generic
discovery yields nothing. Playlist, channel, and ID-only bulk helpers also ask
for optional source-site access at the moment the user invokes them.

## Features

- Native/runtime caption discovery works while playback is paused.
- Multiple discovered text tracks remain selectable by language/label.
- Clickable timestamps seek the active media element.
- Search, highlights, notes, saved transcripts, tags, and recent history.
- TXT, SRT, VTT, JSON, CSV, Markdown, Notion, and Obsidian exports.
- Playlist/channel/CSV batch extraction and ZIP export.
- On-device Summary, Key points, Q&A, and transcript chat.
- Live active-tab transcription and dropped-file transcription through Chrome
  built-in AI.

Live transcription follows the player state: it suspends while playback is
paused or muted, finishes when media ends, reports media-time progress, skips
silent chunks, and discards model refusal prose. File transcription uses real
decode progress.

## Install from source

Requirements:

- Node 22 or newer.
- Chrome with side-panel support.
- Chrome desktop 138+ and supported GPU hardware only for audio transcription.
  Native caption extraction does not require built-in AI.

```bash
git clone https://github.com/ANcpLua/yt-transcript.git
cd yt-transcript
npm install
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
and select `dist/`.

## Usage

1. Open a media page and click the Video Transcript toolbar action.
2. The side panel checks native timed text immediately; playback may remain
   paused.
3. For a pasted URL, the extension opens the page visibly. Click the toolbar
   action on that page once to grant temporary inspection access.
4. If a cross-origin media source could not be inspected, choose
   **Inspect media sources** and accept Chrome's exact-origin prompt. The
   extension then fetches only detected timed-text resources in its service
   worker, outside the page's Content Security Policy.
5. Use **Transcribe live audio** only when no native transcript is available;
   start or resume playback first.
6. Drop a local audio/video file anywhere in the panel for on-device
   transcription.

## Supported timed-text discovery

Fully parsed:

- HTML runtime `TextTrack` / `VTTCue`
- WebVTT and segmented WebVTT text resources
- SRT
- TTML, DFXP, and text-based IMSC documents
- ASS and SSA
- SAMI
- SBV
- LRC
- common timestamped JSON cue shapes

Manifest/resource discovery:

- HLS subtitle playlists, WebVTT segments, and closed-caption signaling
- DASH text adaptations and `wvtt`, `stpp`, `tx3g`, `c608`, and `c708`
  indicators
- MP4/fMP4, bitmap, broadcast, and legacy subtitle candidates

Binary/in-band formats are detected but not falsely presented as parsed text.
When the browser/player does not expose their decoded cues through
`TextTrack`, live on-device transcription is the fallback.

## Privacy and permissions

Required permissions are `sidePanel`, `activeTab`, `scripting`, `storage`,
`tabCapture`, and `offscreen`. Optional HTTP(S) host access exists only so the
user can grant an embedded frame or bulk source at runtime. There is no
permanent host permission and no always-on content script.

See [PRIVACY.md](PRIVACY.md).

## Development

```bash
npm run lint
npm test
npm run build
npx playwright test
npm run zip
```

The browser suite uses an unpacked extension and CDP's real toolbar-action
invocation. Its paused-media fixtures prove runtime cues and WebVTT are found
before audio transcription, including a cross-origin VTT blocked by page CSP.
A deterministic watch-page fixture verifies the optional page-adapter fallback
without external network traffic.

## License

[MIT](LICENSE)
