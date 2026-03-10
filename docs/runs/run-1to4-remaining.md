# Remaining Gaps: Runs 1-4 Audit

## Context

All 4 runs were implemented by parallel agents. A Playwright-verified audit found 10 remaining gaps. Build is clean (
zero TS errors, 77KB gzipped main bundle). Core extraction pipeline, all exports, AI panel, persistence, and modal
wiring are working.

**Current state:** App renders, header nav works (Settings/History/Saved modals), URL validation works, preferences
persist, history auto-populates, AI panel wired with props, rate-limiting in place, reduced-motion CSS added.

**Blocker:** YouTube Innertube API returns `UNPLAYABLE` for all videos (see gap #10). No transcript can be fetched until
this is resolved. All other gaps are UI integration — the backend logic exists but isn't wired to the frontend.

---

## Gap 1: Chapter extraction + chapter UI

**What exists:**

- `Chapter` type in `src/types/transcript.ts` (lines 42-45): `{ title: string; start: number }`
- `exportMarkdown.ts` supports chapter headings in output (lines 108-134)
- YouTube IFrame Player API loaded in `App.tsx`

**What's missing:**

- Innertube player response parsing for chapters — YouTube returns chapter data in `videoDetails.chapters` or as
  description timestamps
- A `parseChapters(description: string): Chapter[]` function that extracts timestamp-title pairs from video
  descriptions (`0:00 Intro\n1:30 Topic`)
- Chapter headers rendered as dividers in `TranscriptView.tsx` between segments
- Collapsible chapter sections (click heading to expand/collapse)

**Files to modify:**

- `functions/api/transcript.ts` — extract `chapters` from Innertube response, add to `TranscriptResponse`
- New: `src/lib/parseChapters.ts` — parse description timestamps into `Chapter[]`
- `src/types/transcript.ts` — add `chapters?: Chapter[]` to `TranscriptResponse`
- `src/components/TranscriptView.tsx` — render chapter dividers between segments, collapsible sections

**DoD:** Videos with chapters show section dividers. Videos without chapters show no dividers. Collapse/expand works.
Chapters included in Markdown export.

---

## Gap 2: Highlights + Notes UI per segment

**What exists:**

- `SavedTranscript` type has `highlights: number[]` and `notes: NoteEntry[]`
- `updateHighlights()` and `updateNotes()` in `src/lib/storage/saved.ts`
- IndexedDB storage fully implemented

**What's missing:**

- Per-segment highlight icon in `TranscriptView.tsx` — click to toggle yellow left border
- Per-segment note icon — click to expand inline textarea below segment
- Visual indicators: highlighted segments get persistent colored left border; note icon shows filled when note exists
- Auto-save to IndexedDB when highlights/notes change (prompt to save transcript first if not saved)
- "Export highlights only" option in `ExportBar.tsx`
- "Export with notes" toggle — Markdown export renders notes as `> Note: ...` blockquotes

**Files to modify:**

- `src/components/TranscriptView.tsx` — add highlight/note icons per segment row, accept `savedTranscript` prop
- `src/App.tsx` — pass saved transcript data to TranscriptView, handle highlight/note updates
- `src/components/ExportBar.tsx` — add "Highlights only" export option

**DoD:** Click highlight icon toggles highlight. Click note icon opens inline editor. Both persist across page reloads.
Export highlights produces filtered output.

---

## Gap 3: Tags add/edit UI

**What exists:**

- `SavedTranscript.tags: string[]` in types
- `updateTags()` in `src/lib/storage/saved.ts`
- `SavedList.tsx` filters by tag and displays tag pills

**What's missing:**

- Tag input UI on saved transcript view — comma-separated or chip-style input
- Ability to add/remove tags from the transcript view (not just from SavedList)
- Inline tag editor below the transcript title when transcript is saved

**Files to modify:**

- `src/App.tsx` — add tag editor section when transcript is saved
- New: `src/components/TagEditor.tsx` — chip-style tag input with add/remove

**DoD:** Tags added from transcript view. Tags visible in SavedList. Filter by tag works.

---

## Gap 4: Playlist/Channel URL detection + selection UI

**What exists:**

- `functions/api/playlist.ts` — GET `/api/playlist?id=PLxxxxx`, Innertube browse with VL prefix, pagination
- `functions/api/channel.ts` — GET `/api/channel?handle=@xxx`, recent 30 videos
- `PlaylistResponse` and `ChannelResponse` types
- `BatchInput.tsx` has batch processing mode

**What's missing:**

- `parseUrl.ts` — detect playlist URLs (`youtube.com/playlist?list=PLxxxxx`, `watch?v=xxx&list=PLxxxxx`) and channel
  URLs (`youtube.com/@handle`, `/channel/UCxxx`, `/c/name`)
- New export: `parsePlaylistId(input: string): string | null` and `parseChannelHandle(input: string): string | null`
- `UrlInput.tsx` — when playlist/channel detected, show different UI flow:
    1. Fetch video list from `/api/playlist` or `/api/channel`
    2. Show video list with checkboxes (all checked by default)
    3. "Select All / Deselect All" toggle
    4. "Get Transcripts" button feeds selected video IDs into batch queue
- For channels: show "Showing 30 most recent uploads" note

**Files to modify:**

- `src/lib/parseUrl.ts` — add `parsePlaylistId()`, `parseChannelHandle()`
- `src/components/UrlInput.tsx` — detect playlist/channel, show selection UI
- `src/App.tsx` — handle playlist/channel flow, integrate with batch

**DoD:** Paste playlist URL → see video list with checkboxes → "Get Transcripts" batch-processes selected videos. Same
for channel URLs.

---

## Gap 5: Batch results browsing view

**What exists:**

- `BatchProgress.tsx` — progress bar, per-video status, retry/cancel/export buttons
- `BatchProcessor` class in `src/lib/batch/queue.ts` — stores results per video
- "View" button per completed item in BatchProgress

**What's missing:**

- A `BatchResultsView` component or integration that lets user click a batch result and view the full transcript in the
  main `TranscriptView`
- Cache batch results in memory so switching between transcripts is instant (no re-fetch)
- Navigation: "Back to batch results" button when viewing a single result

**Files to modify:**

- `src/App.tsx` — add batch state management, handle `onViewResult` callback
- New: `src/components/BatchResultsNav.tsx` — tabs or list to switch between batch transcripts

**DoD:** Complete a batch → click "View" on any result → see full transcript. Switch between results without
re-fetching. "Back to batch" navigation.

---

## Gap 6: Filler word removal toggle

**What exists:**

- `src/lib/cleanText.ts` — `removeFillersFromSegments(segments, lang)` fully implemented
- English fillers with word-boundary matching, Spanish/French/German support
- Conservative removal (preserves "I like dogs", removes "Like, I was going")

**What's missing:**

- Toggle in `TranscriptView.tsx` toolbar: "Clean fillers" checkbox (default OFF)
- When ON, apply `removeFillersFromSegments()` to displayed segments
- Exports respect this toggle

**Files to modify:**

- `src/components/TranscriptView.tsx` — add toggle, apply `removeFillersFromSegments()` in `displaySegments` memo
- `src/components/ExportBar.tsx` — accept `cleanFillers` prop

**DoD:** Toggle ON removes fillers visually. Export with toggle ON produces cleaner text. "I like dogs" preserved.

---

## Gap 7: Speaker labels display

**What exists:**

- `src/lib/detectSpeakers.ts` — `detectSpeakers(segments)` with bracket/colon/chevron heuristics
- `SegmentWithSpeaker` type extends `Segment` with `speaker?: string`
- `getUniqueSpeakers()` and `filterBySpeaker()` helpers

**What's missing:**

- Run `detectSpeakers()` on loaded segments in `TranscriptView.tsx`
- Display colored speaker name tag before segment text
- Consistent color per speaker (hash speaker name to color palette)
- "Filter by speaker" dropdown or clickable speaker tags

**Files to modify:**

- `src/components/TranscriptView.tsx` — detect speakers on mount, render speaker tags, add filter dropdown

**DoD:** Videos with speaker labels show colored names. Filter by speaker works. Videos without speakers show nothing (
no false positives).

---

## Gap 8: Legal page

**What exists:**

- Nothing — no `/legal` route or component

**What's needed:**

- Simple static page at `/legal` route:
    - What data we process (YouTube URLs, transcripts in browser memory)
    - What we don't store (nothing server-side)
    - Third-party services (YouTube for transcripts, user-chosen AI provider)
    - GDPR: no personal data collected, no cookies, no tracking
    - Disclaimer: "Not affiliated with YouTube or Google"
- Footer link to legal page from main app
- Client-side routing (hash-based or simple conditional render — no React Router needed)

**Files to create:**

- `src/components/LegalPage.tsx`

**Files to modify:**

- `src/App.tsx` — add route/state for legal page, add footer with link

**DoD:** `/legal` or clicking "Legal" in footer shows the legal page. Back button returns to app.

---

## Gap 9: Storage quota 80% warning

**What exists:**

- `Settings.tsx` shows "Local storage: ~X KB used" (localStorage only)
- `navigator.storage.estimate()` available for IndexedDB quota

**What's missing:**

- Estimate IndexedDB usage via `navigator.storage.estimate()`
- Show combined usage (localStorage + IndexedDB)
- Warning banner when usage exceeds 80% of estimated quota
- Displayed in Settings storage section

**Files to modify:**

- `src/components/Settings.tsx` — add IndexedDB quota check, show warning at 80%

**DoD:** Settings shows combined storage usage. Warning appears when >80% of browser quota used.

---

## Gap 10: YouTube Innertube API UNPLAYABLE (BLOCKER)

**What exists:**

- `functions/api/transcript.ts` — calls Innertube `youtubei/v1/player` with `clientName: "WEB"`,
  `clientVersion: "2.20240101.00.00"`

**Problem:**

- YouTube now returns `playabilityStatus.status: "UNPLAYABLE"` with 0 caption tracks for ALL videos
- The `clientVersion` is stale (January 2024)
- YouTube has tightened authentication requirements since ~June 2025
- Affects all tools using undocumented Innertube API

**Possible fixes (in order of feasibility):**

1. **Update client version** — change to a recent `clientVersion` (e.g., `2.20260301.00.00`). YouTube sometimes checks
   this.
2. **Use `ANDROID` or `IOS` client** — different client names may have different restrictions:
   ```json
   { "clientName": "ANDROID", "clientVersion": "19.29.37", "androidSdkVersion": 30 }
   ```
3. **Use `WEB_EMBEDDED_PLAYER`** — for embeddable videos:
   ```json
   { "clientName": "WEB_EMBEDDED_PLAYER", "clientVersion": "1.20240101.00.00" }
   ```
4. **Add `po_token`** — some videos require a Proof of Origin token. The `youtube-transcript-api` Python library has
   tackled this with browser-based token generation.
5. **Scrape the watch page** — fetch `youtube.com/watch?v=ID`, extract `ytInitialPlayerResponse` from the HTML, which
   contains caption track URLs. More fragile but may bypass API restrictions.
6. **Browser extension approach** — requests come from user's browser IP (not datacenter), avoiding IP-based blocking.
   Major architecture change.

**Files to modify:**

- `functions/api/transcript.ts` — try updated client config
- Potentially `functions/_shared/innertube.ts` — refactor client config for easy swapping

**DoD:** `curl -X POST /api/transcript -d '{"videoId":"dQw4w9WgXcQ"}'` returns segments (not UNPLAYABLE). Test with 3
different videos.

--- 

## Priority order

| Priority | Gap                      | Reason                                              |
|----------|--------------------------|-----------------------------------------------------|
| P0       | #10 Innertube UNPLAYABLE | Blocker — nothing works without transcripts         |
| P1       | #6 Filler toggle         | 5-line change, high user value                      |
| P1       | #7 Speaker labels        | Detection code exists, just needs UI wiring         |
| P2       | #1 Chapters              | Enriches reading experience significantly           |
| P2       | #4 Playlist/Channel UI   | Unlocks bulk features that are already built        |
| P2       | #5 Batch results view    | Completes the batch flow                            |
| P2       | #2 Highlights/Notes      | Core persistence feature                            |
| P3       | #3 Tags UI               | Nice-to-have on top of saved transcripts            |
| P3       | #8 Legal page            | Required for production but not user-facing feature |
| P3       | #9 Storage warning       | Edge case, most users won't hit quota               |
