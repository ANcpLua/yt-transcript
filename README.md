# Video Transcript

Browser extension (Chrome, Edge, Firefox) that turns the captions a media page
already carries into searchable, exportable text. It inspects a page only
after the user clicks the toolbar action on it. When a page has no readable
timed text, Chrome's built-in on-device model can transcribe the tab's audio or
a dropped file. No backend, accounts, API keys, analytics, or paid services.

This file is the operating manual. Everything an operator or a future agent
needs is here or linked from here.

## Stores

<!-- store-config:start -->
| Store | Listing | Dashboard | API docs | Credentials (GitHub Actions secrets) | Notes |
| --- | --- | --- | --- | --- | --- |
| Chrome Web Store | [ahddbfbjafmbceehebpeanpnlbaimepk](https://chromewebstore.google.com/detail/ahddbfbjafmbceehebpeanpnlbaimepk) | [dashboard](https://chrome.google.com/webstore/devconsole) | [docs](https://developer.chrome.com/docs/webstore/using-api) | `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID` | Listing text, screenshots and privacy answers are edited in the dashboard; answers are kept in store/privacy-fields.md |
| Microsoft Edge Add-ons | [069ca91d-a7cd-4bac-8224-1ee38a2d2a06](https://microsoftedge.microsoft.com/addons/detail/video-transcript/jkcfajddmmeapfabpoekfiemnbdaofeo) | [dashboard](https://partner.microsoft.com/en-us/dashboard/microsoftedge/069ca91d-a7cd-4bac-8224-1ee38a2d2a06/packages/dashboard) | [docs](https://learn.microsoft.com/microsoft-edge/extensions/update/api/using-addons-api) | `EDGE_API_KEY`, `EDGE_CLIENT_ID` | API key expires 2026-11-21 (70 days from 2026-09-12). Ships the Chromium build verbatim. Renew the key at https://partner.microsoft.com/en-us/dashboard/microsoftedge/publishapi and update it in both extension repos |
| Firefox Add-ons (AMO) | [video-transcript@qyl.at](https://addons.mozilla.org/firefox/addon/video-transcript/) | [dashboard](https://addons.mozilla.org/developers/addon/video-transcript/edit) | [docs](https://mozilla.github.io/addons-server/topics/api/addons.html) | `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | One API key pair per Mozilla account, shared with the other extension repo; a new key invalidates the old one everywhere. The listing text is applied from store/listing.md |
<!-- store-config:end -->

The table is rendered from [`store.config.json`](store.config.json) by the
shared [store-publish](https://github.com/ANcpLua/store-publish) tool, which
save-media owns; this repository only consumes it and files issues there.
Change the config, then run `bunx store-publish readme --write`; CI fails when
the two drift. A new extension copies that file and changes the ids.

Credentials are GitHub Actions secrets in this repository. GitHub never
returns their values, so a credential can only be tested in an Actions run,
never locally. The same ten values are also set on
[save-media](https://github.com/ANcpLua/save-media), which shares the Chrome
OAuth client, the Edge Publish API key, and the AMO key pair.

Two rules that have already cost a day each:

- Never generate a new AMO key. Mozilla issues one key pair per account. A new
  pair invalidates the old one immediately and breaks publishing in both
  repositories. An HTTP 401 almost always means the stored value is mangled,
  not that the key is gone.
- Never move a secret through the clipboard. A value read back with `pbpaste`
  is not always what was copied. Check the length before writing: the Edge API
  key is 40 characters, the Edge client id and product id are 36.

Where the readable copies live on the owner's machine (presence only, never
print values):

| Credential | Location |
| --- | --- |
| AMO key pair | macOS Keychain item `AMO API (addons.mozilla.org)`; the issuer is the account field |
| Chrome OAuth client id and secret | `~/.config/vitals/cws-client.json` |
| Chrome refresh token | `~/.config/vitals/cws-refresh-token.txt` |
| Edge client id and API key | `~/.config/vitals/store-secrets.env`, mode 600 |
| Register of all secret locations | `~/.config/vitals/keys.json` |
| Script that writes the values into both repositories | `~/.config/vitals/set-store-secrets.sh` |

The Chrome OAuth client is "Desktop client 2" in Google Cloud project `server`
(`uplifted-nuance-408417`); its consent screen is in production.

## Store status without publishing

```sh
gh workflow run store-status.yml -R ANcpLua/yt-transcript --ref main -f store=chrome
gh workflow run store-status.yml -R ANcpLua/yt-transcript --ref main -f store=firefox
gh workflow run store-status.yml -R ANcpLua/yt-transcript --ref main -f store=edge
gh workflow run store-status.yml -R ANcpLua/yt-transcript --ref main -f store=amo-listing-diff
gh run list -R ANcpLua/yt-transcript --workflow=store-status.yml --limit 1
gh run view <run id> -R ANcpLua/yt-transcript --log
```

- `chrome` prints the published revision and, while a review is open, the
  submitted revision with its state.
- `firefox` lists every version with its review status.
- `edge` has no read endpoint. The step probes the credentials with an
  operation id that cannot exist (HTTP 401 means rejected, anything else means
  accepted), prints the lengths of the three values, and prints the days left
  until the API key expires. It fails once the key has expired.
- `amo-listing-diff` compares the `## AMO description` section of
  [`store/listing.md`](store/listing.md) with the live AMO description.
  `amo-listing-apply` writes it. This is the only path that edits listing
  text; Chrome and Edge listing text is edited in their dashboards.

## Release

Versions live in `manifest.json`, `manifest.firefox.json`, and
`package.json`, and must match. The release workflow refuses a mismatch.

```sh
# 1. bump the three versions, add a CHANGELOG entry, commit
# 2. tag and push; the tag runs release.yml against all three stores
git tag v3.2.0
git push origin main v3.2.0
# 3. watch it; cancel on the first red job
gh run watch -R ANcpLua/yt-transcript --exit-status $(gh run list -R ANcpLua/yt-transcript --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

To publish to one store only, for example after Chrome finished a review that
blocked an earlier upload:

```sh
gh workflow run release.yml -R ANcpLua/yt-transcript --ref main -f stores=chrome
```

What the workflow does: lint, unit tests, listing lint, README table check,
build, zip, then for each selected store `store-publish <store> release`, and
on a tag a GitHub release with the four zips (`chrome`, `edge`, `firefox`,
`source`; Edge ships the Chromium build verbatim, `source` is the archive AMO
requires for bundled builds).

Store facts that shape this:

- Chrome refuses every upload while a review is open ("You may not edit or
  publish an item that is in review"). A review cannot be cancelled. Wait for
  the decision, then dispatch `stores=chrome`.
- Edge can refuse a package upload while its certification is running. Do not
  tag a release while either store has a review open, or the tag ends half
  delivered; check `store-status` for both first.
- Chrome rejected 3.0.0 once as keyword spam ("Yellow Argon") for a run of
  file-format acronyms in the description. `store-publish lint` rejects such
  comma chains and the words bypass, unlock, circumvent. Keep any one keyword
  under five uses.
- A trademark complaint over a platform name in the extension name was closed
  by renaming to Video Transcript. No platform names in user-facing text; the
  adapter, permissions, fixtures, and technical docs may name one when
  necessary.
- AMO stores the listing under the locale the add-on was created with, which
  is `de` even though the text is English. The tool reads that locale from the
  add-on; never hardcode one, or a second translation appears and the served
  one stays stale.
- The Chrome Web Store privacy form does not carry answers forward. They are
  kept in [`store/privacy-fields.md`](store/privacy-fields.md).
- Firefox reviewers rebuild from the source zip using
  [`AMO_BUILD.md`](AMO_BUILD.md).

## Expiry dates

| What | Expires | Renew at |
| --- | --- | --- |
| Edge Publish API key | 2026-11-21 | https://partner.microsoft.com/en-us/dashboard/microsoftedge/publishapi, then update `EDGE_API_KEY` in both repositories and `stores.edge.expires` in `store.config.json` |
| Chrome refresh token | none, but Google revokes it after six months without use or on a consent-screen change | https://developers.google.com/oauthplayground with the same client, then `CWS_REFRESH_TOKEN` in both repositories |
| AMO key pair | none | do not regenerate, see above |

## Development

Requirements: Bun 1.4 or newer as the package manager, Node 22.11 or newer as
the runtime for Vite, esbuild, and the unit tests, Chrome with side-panel
support. Audio transcription additionally needs Chrome 138 or newer with the
on-device model available on the machine; caption discovery does not.

```sh
bun install --frozen-lockfile
bun run lint         # tsc, strict
bun run test         # unit tests, node --test
bun run build        # dist/ (Chrome, Edge) and packages/extension/dist-firefox/
bunx playwright test # browser suite against the unpacked build
bun run zip          # build plus the four store zips
```

Load `dist/` as an unpacked extension for manual checks.

Toolchain decision, shared with save-media so a third extension can copy
either repository: bun installs packages (`bun.lock` is the only lockfile),
Vite and esbuild bundle, Playwright runs the browser suite. Bun is not the
bundler: MV3 needs Vite's and esbuild's output. Unit tests run with
`node --test` for now; they move to Vitest, the runner save-media already uses,
once Chrome has finished reviewing 3.1.0. `bun test` is not used: it is a
third runner that is neither a drop-in for `node:test` nor able to run
save-media's jsdom tests, and one runner across both repositories is worth
more than the dependency Vitest adds. Run tests with `bun run test`, never
`bun test`.

### Constraints

- Zero cost: no backend, accounts, credits, paid APIs, or server.
- AI is Chrome built-in AI only. No API keys, no bundled ML runtime.
- No tracking, analytics, cookies, or telemetry. No dependency that phones
  home.
- React 19, Vite, Tailwind CSS 4, strict TypeScript. No `any`, `@ts-ignore`,
  or double-cast escapes.
- `chrome.storage` and IndexedDB, never `localStorage`.
- Designed for a 400 px side panel.
- No `console.log` in shipped code.
- Correctness and coherence over API stability. Delete superseded paths
  instead of adding compatibility layers; update every caller in the same
  change.
- Removed features stay removed: sentiment, topics, mind map, quotes, study
  guide, quiz, flashcards, bilingual view, speaker detection.

### Verifying a change

1. `npm run lint`, `npm test`, `npm run build`, `npx playwright test`.
2. No new dependency without a reason, no new network host, no platform name
   in user-facing text.
3. For anything touching discovery or audio, load `dist/` unpacked and walk
   the manual checks below.

Manual checks in real Chrome:

1. Open a captioned media page, click the toolbar action. A Native pill appears
   without starting playback. Pause the media and repeat; the transcript still
   loads.
2. On a page with cross-origin media sources use **Inspect media sources**,
   grant the exact origin, and confirm cues load. The fetch runs in the
   service worker, so page CSP cannot block it.
3. On a captionless page the panel reports that no native text was found
   before it offers **Transcribe live audio**.
4. Live transcription: pausing shows a resume hint, resuming delivers
   segments, muting suspends capture, media end finalizes, and refusal or help
   prose never appears as transcript text.
5. Drop a speech file and check the on-device result.
6. Inspect the service worker and offscreen document for errors and confirm
   there are no tracking or model-provider requests.

## How extraction works

Native timed text is always attempted before audio. Audio is an explicit
fallback, never the primary path.

- **L0, user-granted page discovery.** `chrome.action.onClicked` opens the
  side panel for that tab and grants `activeTab`. The service worker injects
  `src/content/timed-text-bridge.ts` (isolated world) and
  `src/content/timed-text-main.ts` (main world). No manifest content scripts,
  no permanent host permissions. A pasted URL opens visibly in a new tab with
  a SCAN badge; the user clicks the action there once. A background tab never
  inherits `activeTab`. The side panel is enabled per tab, so it follows the
  tab the user invoked it on.
- **L1, browser runtime tracks.** The bridge inspects every accessible
  `<video>` and `<audio>`: `TextTrackList`, runtime `TextTrack` objects,
  `VTTCue` lists, child `<track>` elements, all roles, and playback state.
  Disabled subtitle tracks are switched to hidden so Chrome loads cues without
  rendering them. Mutations and media events rescan.
- **L2, timed-text resources.** The main-world observer checks prior
  `PerformanceResourceTiming` entries, future `fetch` and XHR responses,
  `<track src>`, `blob:` and `data:` tracks. Candidate detection is
  centralized in `src/lib/timed-text/detect.ts`; the URL-marker and MIME
  allowlists are locked by unit tests. Text bodies are read with a 2 MiB
  ceiling; binary media is never decoded as text; unrelated JSON is discarded
  unless it holds timestamped cues. Cross-origin text is reported as metadata
  and fetched by the service worker after an exact-origin grant, outside page
  CSP.
- **L3, formats and manifests.** `src/lib/timed-text/parse.ts` normalizes
  WebVTT, SRT, TTML/DFXP/IMSC text, ASS/SSA, SAMI, SBV, LRC, and common
  timestamped JSON. `src/lib/timed-text/manifest.ts` expands HLS subtitle
  playlists and DASH text representations and records CEA signaling and
  binary text it cannot decode. Bitmap, broadcast, and MP4 timed text are
  detected, never claimed as decoded.
- **L4, optional page adapter.** If generic discovery finds nothing on a
  compatible watch page, `src/content/adapters/youtube.ts` is injected once as
  a bounded fallback. It is not statically registered and never leaks
  platform wording into the UI. Playlist, channel, CSV, and bare-ID bulk tools
  ask for optional source-site access from the user's click.
- **L5, live audio.** `src/background/transcribe/tab-capture.ts` consumes a
  user-granted `tabCapture` stream in the offscreen document, resamples to
  16 kHz mono, and prompts Chrome's on-device model in 8-second windows. The
  pipeline suspends on pause or mute, finalizes at media end, timestamps from
  media time, skips silence, discards refusal prose, and keeps tab audio
  audible. Availability is gated by `LanguageModel.availability(...)` with
  audio input declared; unsupported hardware fails loudly. Dropped files go
  through `OfflineAudioContext.decodeAudioData` into the same window function.

Messages between the service worker, offscreen document, and side panel are
validated with zod schemas in `src/lib/messages/schema.ts`; the message types
are inferred from them. Content scripts only import types, so the zod runtime
never ships into page frames.

Verified on real hardware (Apple silicon, Chrome 152, 2026-09-12): the
extension's own prompt transcribed a 6-second and a 20-second synthetic speech
sample verbatim except for words cut by a window boundary. A warm window of 8
seconds takes about 7 seconds; the first inference after a cold start takes
about 20 seconds. The model has no word timestamps, so segment timing stays
window-granular.

## Capabilities

| Capability | Status |
| --- | --- |
| Runtime `TextTrack` and `VTTCue` | Browser-tested while paused |
| Native `<track src>` WebVTT | Browser-tested while paused |
| SRT, TTML/DFXP, ASS/SSA, SAMI, SBV, LRC, timestamped JSON | Fixture-tested |
| HLS WebVTT and DASH text discovery | Fixture-tested |
| Cross-origin embedded player | Optional exact-origin permission flow |
| MP4/fMP4, CEA, bitmap, broadcast formats | Detect-only unless runtime cues exist |
| Optional authenticated page adapter | Deterministic browser fixture |
| Live and file on-device transcription | Verified on Apple silicon; Chrome only |
| Firefox | Native discovery, saving, export; no on-device audio |

Features: single-page extraction, playlist, CSV, and channel bulk extraction,
history, saved transcripts with highlights, notes, and tags, summary, key
points, Q&A, transcript chat, filler removal, chapter extraction, export to
text and subtitle formats, cancelable AI requests, click-to-seek timestamps.

## Layout

```text
src/
  background/
    service-worker.ts          message router, action click, install hygiene
    install.ts                 drops permissions the manifest no longer declares
    panel/                     side panel (Chromium) and sidebar (Firefox)
    discovery/coordinator.ts   L0 to L4 orchestration and SCAN badge
    transcribe/                tab capture, offscreen document, worklet
    providers/                 bulk and ID-only adapter
  content/                     injected discovery scripts, optional adapter
  lib/
    messages/schema.ts         zod wire schemas, inferred message types
    timed-text/                detect, parse, manifest
    transcription/audio.ts
  sidepanel/App.tsx
  components/
  types/                       type-only views of the schemas
scripts/
  build.mjs                    Vite + esbuild for Chrome and Firefox
  package-stores.mjs           the four store zips
store/
  listing.md                   Chrome and AMO description, reviewed source
  privacy-fields.md            Chrome privacy form answers
store.config.json              store ids, URLs, credential names
e2e/, tests/unit/              Playwright suite, unit tests
```

## Privacy

Required permissions: `sidePanel`, `activeTab`, `scripting`, `storage`,
`tabCapture`, `offscreen`. Optional HTTP(S) host access exists only so the
user can grant an embedded frame or bulk source at runtime. There is no
permanent host permission and no always-on content script. See
[PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
