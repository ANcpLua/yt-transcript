# Video Transcript — engineering instructions

Every user-facing surface must remain platform-generic. Internal adapters,
permissions, fixtures, and technical documentation may name a source when
technically necessary.

## Engineering policy

Correctness, coherent design, maintainability, and operational reliability
take priority over API stability. Breaking changes are free. Delete obsolete
logic instead of adding compatibility shims, migration layers, wrappers, or
parallel old/new paths. Update current repository callers in the same change.

Do not preserve code merely to keep hypothetical downstream callers compiling.
Do keep the code written in this repository type-correct, built, tested, and
internally coherent.

## Hard constraints

- Zero cost: no backend, accounts, credits, paid APIs, or server.
- AI is Chrome built-in AI only. No API keys or bundled ML runtime.
- No tracking, analytics, cookies, or telemetry.
- React 19, Vite, Tailwind CSS 4, and strict TypeScript.
- No `any`, `@ts-ignore`, or double-cast type escapes.
- No npm package that phones home.
- Use `chrome.storage`/IndexedDB, never `localStorage`.
- Design for a 400 px Chrome side panel.

## Priority

P0 is a reliable single-transcript path in real Chrome. Native timed text must
always be attempted before audio transcription. Audio is an explicit fallback,
not the primary extraction architecture.

## Extraction architecture

### L0 — user-granted page discovery

`chrome.action.onClicked` opens the side panel and grants `activeTab` on the
current page. The service worker injects two generic scripts with
`chrome.scripting`:

- `src/content/timed-text-bridge.ts` in the isolated world
- `src/content/timed-text-main.ts` in the page's main world

There are no manifest-declared content scripts and no permanent host
permissions.

For pasted URLs, the destination opens visibly and the extension arms a SCAN
badge. The user clicks the toolbar action on that tab once. A newly opened
background tab is never treated as if it inherited `activeTab`.

### L1 — browser runtime tracks

The isolated bridge inspects every accessible `<video>` and `<audio>`:

- `TextTrackList`
- runtime `TextTrack` objects
- `TextTrackCueList` / `VTTCue`
- child `<track>` elements
- roles: subtitles, captions, descriptions, chapters, and metadata
- playback state: time, duration, paused, ended, muted, volume, readiness

Disabled subtitle/caption/description tracks are switched to hidden mode so
Chrome can load cues without rendering them over the player. Mutations,
`addtrack`, `change`, `cuechange`, and media playback events rescan the page.

### L2 — timed-text resources

The main-world observer checks prior PerformanceResourceTiming entries, future
`fetch` responses, future XHR responses, `<track src>`, `blob:` text tracks,
and `data:` text tracks.

Candidate detection is centralized in `src/lib/timed-text/detect.ts`. The
complete URL-marker and MIME allowlists live there and are locked by unit
tests. Candidate is not the same as parse success:

- text bodies are read locally with a 2 MiB ceiling;
- large/binary media responses are never decoded as text;
- unrelated JSON may be inspected but is discarded unless timestamped cues
  are found;
- resource and cue duplicates are normalized before publication.

Cross-origin text resources are reported to the service worker as metadata.
After an exact-origin permission grant, the service worker performs the bounded
fetch. Page CSP therefore cannot block the caption request.

### L3 — formats and manifests

`src/lib/timed-text/parse.ts` normalizes:

- WebVTT
- SRT
- TTML / DFXP / text IMSC shapes
- ASS / SSA
- SAMI
- SBV
- LRC
- common timestamped JSON shapes

`src/lib/timed-text/manifest.ts` expands HLS subtitle playlists and DASH text
representations. It records embedded CEA signaling and segmented/binary text it
cannot safely decode.

Candidate-only formats include broadcast files, bitmap subtitles, MP4/fMP4
timed text, and legacy subtitle uploads that do not match a supported text
parser. Do not claim decoded text for them. Browser runtime cues may still make
their decoded representation available through L1.

### L4 — optional page adapter

If generic discovery returns no transcript on a compatible watch page,
`src/content/adapters/youtube.ts` is injected once as a bounded fallback. It
uses the page's authenticated caption surfaces and sends the existing
`intercepted-capture` messages to the correlator.

This adapter is not statically registered, does not define the main routing
model, and must not leak platform-specific wording into the UI.

Playlist, channel, CSV, and bare-ID workflows remain specialized bulk tools.
They request optional source-site access only from the user's invoking click.

### L5 — live audio fallback

`src/background/transcribe/tab-capture.ts` consumes a user-granted
`tabCapture` stream ID in the offscreen document. Audio is resampled to 16 kHz
mono and sent in 8-second windows to Chrome's Prompt API audio input.

The live pipeline:

- suspends and drops buffered samples while playback is paused or muted;
- resumes from fresh samples;
- finishes when media ends or the user chooses Stop;
- timestamps from media time rather than fabricated chunk progress;
- skips low-energy silence;
- discards model refusal/help prose;
- preserves audible tab playback.

Nano has no word-level timestamps. Segment timing remains window-granular.
Audio availability is gated by
`LanguageModel.availability({expectedInputs, expectedOutputs, outputLanguage})`
and must fail loudly on unsupported hardware.

### File transcription

The panel creates a temporary blob URL for a dropped/picked file. The offscreen
document uses `OfflineAudioContext.decodeAudioData`, mixes to mono, resamples,
and feeds the same 8-second inference function. Blob URLs are revoked on
completion, error, cancellation, or replacement.

## Capability matrix

| Capability | Status |
|---|---|
| Runtime `TextTrack` and `VTTCue` | Done; browser-tested while paused |
| Native `<track src>` WebVTT | Done; browser-tested while paused |
| SRT, TTML/DFXP, ASS/SSA, SAMI, SBV, LRC | Done; fixture-tested |
| Common timestamped JSON | Done; fixture-tested |
| HLS WebVTT discovery | Done; fixture-tested |
| DASH text-representation discovery | Done; fixture-tested |
| Cross-origin embedded player | Optional origin permission flow |
| MP4/fMP4 / CEA / bitmap / broadcast formats | Detect-only unless runtime cues exist |
| Optional authenticated page adapter | Done; deterministic browser fixture |
| Live and file Nano transcription | Done; hardware accuracy still requires real-Chrome verification |

## Feature parity

| ID | Feature | Status |
|---|---|---|
| F-001 | Single transcript extraction | Done through generic discovery; optional adapter fallback retained |
| F-002 | Playlist bulk extraction | Done |
| F-003 | CSV bulk upload | Done |
| F-004 | Channel transcripts | Done |
| F-005 | History | Done |
| F-006 | Summary | Done |
| F-009 | Q&A extraction | Done |
| F-010 | Chat with transcript | Done |
| F-018 | Highlights and notes | Done |
| EXTRA-001 | Filler removal | Done |
| EXTRA-003 | Chapter extraction | Done |
| EXTRA-005 | Multi-format export | Done |
| EXTRA-007 | Cancel AI request | Done |
| EXTRA-008 | Click timestamp to seek | Done |
| EXTRA-009 | Dropped-file transcription | Done; real-GPU accuracy sign-off required |
| EXTRA-010 | Active-tab transcription | Done; real-GPU accuracy sign-off required |
| EXTRA-011 | Platform-independent native discovery | Done |

Removed features and prompts stay removed. Do not restore sentiment, topics,
mindmap, quotes, study guide, quiz, flashcards, bilingual view, or redundant
speaker detection.

## Project structure

```text
src/
  background/
    discovery/coordinator.ts
    service-worker.ts
    transcribe/
      tab-capture.ts
      offscreen.ts
      worklet-processor.ts
    providers/                 # specialized bulk / ID-only adapter
  content/
    timed-text-main.ts
    timed-text-bridge.ts
    adapters/youtube.ts        # optional L4 fallback
  lib/
    timed-text/
      detect.ts
      parse.ts
      manifest.ts
    transcription/audio.ts
  sidepanel/App.tsx
  components/
  types/
```

## Execution protocol

1. Read the files being modified and confirm the described implementation
   still exists.
2. Implement the smallest coherent root-cause change. Delete superseded paths.
3. Run `npm run lint`.
4. Run `npm test`.
5. Run `npm run build`.
6. Run the relevant Playwright specs; use the full suite for release work.
7. Verify 400 px layout, no new dependencies, no tracking hosts, no
   user-facing platform names, and no `console.log`.
8. For a release, update manifest/package/lock versions together, build the
   ZIP, inspect its contents, commit, push, tag, and publish the release
   artifact.

## Build and test

```bash
npm run lint
npm test
npm run build
npx playwright test
npm run zip
```

The deterministic browser tests cover:

- MV3 registration and side-panel entry
- no permanent host access or static content scripts
- pasted generic URL permission handoff at 400 px
- paused runtime cues
- paused WebVTT and language switching
- exact-origin cross-site WebVTT fetch outside page CSP
- discovery-session recovery through `chrome.storage.session`
- optional adapter fallback
- Prompt API language options
- real WAV decode through the offscreen contract

## Real-Chrome verification

1. Run `npm run build`.
2. Load `dist/` as an unpacked extension.
3. Open a captioned media page and click the toolbar action. A Native pill
   should appear without starting playback.
4. Pause the media and repeat discovery; the transcript must still load.
5. Test a page with cross-origin media sources. If needed, use
   **Inspect media sources**, grant the exact detected origin, and confirm
   native cues load. Cross-origin timed-text bodies are fetched in the service
   worker so the page's Content Security Policy cannot block discovery.
6. Test a captionless page. The panel must show native discovery failure
   before offering **Transcribe live audio**.
7. Start live transcription:
   - pause playback and verify the panel says to resume;
   - resume and verify segments arrive;
   - mute and verify capture suspends;
   - reach media end and verify automatic finalization;
   - confirm refusal/help prose never appears as transcript text.
8. Drop a speech file and verify on-device transcription.
9. Inspect the service worker and offscreen document for errors and confirm no
   tracking/network-provider requests.

## Release

Chrome Web Store listing ID:
`ahddbfbjafmbceehebpeanpnlbaimepk`.

Keep `manifest.json`, `package.json`, and the root package-lock version in
lockstep. `npm run zip` creates `yt-transcript-chrome.zip`. A radical
platform-first to discovery-first rewrite is a major release.
