# Run 2: Reading Experience + All Exports + Languages

## Context (read this first if starting fresh)

**Project:** Free YouTube transcript extraction tool. Zero cost. No accounts. No paid APIs.

**Tech stack:** Vite + React + TypeScript + Tailwind CSS. Cloudflare Pages Functions for API proxy. Single deploy via `wrangler pages deploy dist/`.

**What already exists (Run 1 completed):**
- Project scaffolded: Vite + React + TS + Tailwind + Cloudflare Pages Functions
- `functions/api/transcript.ts` — POST endpoint, fetches transcript via Innertube API
- `functions/api/tracks.ts` — GET endpoint, returns available caption tracks
- `src/components/UrlInput.tsx` — URL input with validation
- `src/components/TranscriptView.tsx` — Basic transcript display with timestamps, search, highlight
- `src/components/ExportBar.tsx` — Copy + TXT + SRT download
- `src/components/ErrorMessage.tsx` — Error states with friendly messages
- `src/lib/parseUrl.ts` — YouTube URL → video ID
- `src/lib/formatTime.ts` — Timestamp formatting
- `src/lib/exportTxt.ts`, `src/lib/exportSrt.ts` — Export generators
- `src/types/transcript.ts` — Shared types
- Deployed to Cloudflare Pages, working end-to-end

**After this run:** Transcript reading is polished (paragraph mode, click-to-seek, playback sync). All export formats work (VTT, JSON, CSV, Markdown). Language selection and bilingual view using YouTube's auto-translate tracks.

---

## Reading Experience Polish

### Paragraph mode

- [ ] **Paragraph merging logic (`src/lib/mergeSegments.ts`)**
  - Function: `mergeIntoParagraphs(segments: Segment[]): ParagraphSegment[]`
  - New type: `ParagraphSegment { start: number; duration: number; text: string; originalSegments: Segment[] }`
  - Merge rules:
    - Consecutive segments merge unless there's a pause > 1.5 seconds between them
    - Or the merged text ends with sentence-ending punctuation (`.` `!` `?`)
    - Or merged text exceeds ~200 words (force break)
  - Preserve original segments inside `originalSegments` for seek granularity
  - Timestamp of merged paragraph = start of first segment
  - Duration = end of last segment - start of first segment
  - DoD: A transcript with 500 short fragments merges into ~30-80 readable paragraphs. Sentence boundaries are respected. No orphaned single-word paragraphs.

- [ ] **Paragraph mode toggle in UI**
  - Toggle button next to timestamp toggle: "Paragraphs: ON/OFF"
  - Default: ON (paragraph mode — this is the key UX differentiator)
  - When ON: render `ParagraphSegment[]` instead of raw `Segment[]`
  - When OFF: render raw segments (current behavior)
  - DoD: Toggle switches view instantly. Paragraph mode produces readable text blocks.

- [ ] **Sentence mode (`src/lib/mergeSegments.ts`)**
  - Function: `mergeIntoSentences(segments: Segment[]): Segment[]`
  - Simpler than paragraphs: merge fragments until sentence-ending punctuation found
  - Each output segment = one complete sentence with its start time
  - DoD: Output reads as proper sentences. Toggle between raw / sentence / paragraph modes.

- [ ] **View mode selector**
  - Replace individual toggles with a segmented control: `Raw | Sentences | Paragraphs`
  - Persists choice in component state (not localStorage yet — that's Run 3)
  - DoD: Three modes work correctly. Switching is instant.

### Compact mode

- [ ] **Compact mode toggle**
  - Button or toggle: "Compact"
  - When ON: reduced font size, tighter line-height, minimal padding between segments
  - When OFF: default comfortable spacing
  - Orthogonal to view mode (can have compact paragraphs or compact raw)
  - DoD: Compact mode fits ~2x more content in viewport. Still readable.

### Click-to-seek

- [ ] **YouTube embed player**
  - When transcript loads, show YouTube IFrame embed above transcript (or side-by-side on wide screens)
  - Use YouTube IFrame Player API: `<iframe>` with `enablejsapi=1`
  - Load IFrame API script: `https://www.youtube.com/iframe_api`
  - DoD: Video player appears after transcript loads. Video is playable.

- [ ] **Click segment → seek video**
  - Clicking any transcript segment calls `player.seekTo(segment.start, true)`
  - Works in all view modes (raw, sentence, paragraph — use first original segment's start for paragraphs)
  - Visual feedback: clicked segment briefly flashes
  - DoD: Click a line at `[03:45]` → video jumps to 3:45.

### Playback sync

- [ ] **Auto-scroll with playback**
  - Poll `player.getCurrentTime()` every 500ms during playback
  - Find the segment whose `start <= currentTime < start + duration`
  - Scroll that segment into view (smooth scroll, centered)
  - Toggle: "Auto-scroll: ON/OFF" — default ON
  - Pause auto-scroll when user manually scrolls (re-enable on toggle or on click-to-seek)
  - DoD: Playing the video causes transcript to scroll along. Disabling toggle stops auto-scroll.

- [ ] **Highlight current segment**
  - Active segment gets a distinct background color (e.g., light blue or primary color at 10% opacity)
  - Highlight moves as playback progresses
  - Works in all view modes
  - DoD: Currently-spoken segment is visually distinct during playback.

### Chapter-aware grouping

- [ ] **Fetch chapter data**
  - YouTube IFrame API or Innertube response may include chapter markers in `videoDetails.chapters`
  - Alternative: parse video description for timestamp patterns (`0:00 Introduction\n1:30 Topic...`)
  - Store as `Chapter { title: string; start: number }[]`
  - DoD: Chapter data extracted for videos that have chapters. Returns empty array for videos without.

- [ ] **Chapter headers in transcript view**
  - If chapters available, insert chapter heading dividers between segments
  - Each chapter heading: bold title + timestamp
  - Collapsible: click chapter heading to expand/collapse that section
  - DoD: Chapters appear as section dividers. Collapse/expand works. Videos without chapters show no dividers.

---

## Export Formats

### VTT export

- [ ] **Download as VTT (`src/lib/exportVtt.ts`)**
  - Button: "VTT" in export bar
  - Valid WebVTT format:
    ```
    WEBVTT

    00:00:00.000 --> 00:00:05.000
    Hello world

    00:00:05.000 --> 00:00:10.000
    Next segment
    ```
  - Header: `WEBVTT` followed by two newlines
  - No sequence numbers (optional in VTT, cleaner without)
  - Timestamps: `HH:MM:SS.mmm` (note: dot not comma — VTT uses `.`, SRT uses `,`)
  - Blank line between cues
  - Filename: `{sanitized-title}_{lang}.vtt`
  - DoD: File accepted by HTML5 `<track>` element and VLC.

### JSON export

- [ ] **Download as JSON (`src/lib/exportJson.ts`)**
  - Button: "JSON" in export bar
  - Structure:
    ```json
    {
      "videoId": "abc123",
      "title": "Video Title",
      "url": "https://www.youtube.com/watch?v=abc123",
      "language": "en",
      "isAutoGenerated": true,
      "extractedAt": "2026-03-10T12:00:00Z",
      "segments": [
        { "start": 0.0, "end": 5.0, "text": "Hello world" }
      ]
    }
    ```
  - `end` = `start + duration` (more useful than `duration` for consumers)
  - Pretty-printed with 2-space indent
  - Filename: `{sanitized-title}_{lang}.json`
  - DoD: Valid JSON. Parseable by `JSON.parse()`. Contains all metadata.

### CSV export

- [ ] **Download as CSV (`src/lib/exportCsv.ts`)**
  - Button: "CSV" in export bar
  - Columns: `start_time,end_time,text`
  - Header row included
  - `text` field properly escaped: wrap in quotes, double any internal quotes
  - Timestamps as `HH:MM:SS.mmm` strings (not raw seconds — more useful in spreadsheets)
  - Filename: `{sanitized-title}_{lang}.csv`
  - DoD: Opens correctly in Excel/Google Sheets. No broken rows from commas or newlines in text.

### Markdown export

- [ ] **Download as Markdown (`src/lib/exportMarkdown.ts`)**
  - Button: "MD" in export bar
  - Format:
    ```markdown
    # Video Title

    **Source:** https://www.youtube.com/watch?v=abc123
    **Language:** English (auto-generated)
    **Extracted:** 2026-03-10

    ---

    **[00:00]** Hello world

    **[00:05]** Next segment about something interesting
    that continues on the next line.

    **[01:30]** Another paragraph here.
    ```
  - If paragraph mode is active, export merged paragraphs (not raw segments)
  - If chapters available, use `## Chapter Title` headings
  - Filename: `{sanitized-title}_{lang}.md`
  - DoD: Renders correctly in any Markdown viewer. Timestamps are bold.

### Export selected range

- [ ] **Range selection UI**
  - User can Shift+Click two segments to select a range (or click + drag)
  - Selected range highlighted with distinct background
  - When range is selected, export buttons export only that range
  - "Clear selection" button or Escape key to deselect
  - When no selection, exports export full transcript (current behavior)
  - DoD: Select a 10-line range → TXT download contains only those 10 lines. Clear selection restores full export.

### Filename normalization

- [ ] **Improve `sanitizeFilename` utility**
  - Remove or replace: `/ \ : * ? " < > |` and control characters
  - Replace spaces with `-`
  - Collapse multiple `-` into one
  - Trim to 80 characters
  - Append language code + format extension
  - Handle Unicode titles gracefully (keep accented chars, CJK, etc. — just strip illegal path chars)
  - DoD: Titles with special characters produce valid filenames on Windows, macOS, and Linux.

---

## Language and Translation (via YouTube auto-translate)

### Language selection

- [ ] **Language dropdown component**
  - After fetching transcript, populate dropdown from `tracks[]` array
  - Show: language name + source badge ("Auto" or "Manual") per track
  - Default: first track (usually original language)
  - Selecting a different language re-fetches transcript with `lang` parameter
  - DoD: Dropdown shows all available languages. Switching language loads that track's transcript.

### YouTube auto-translate integration

- [ ] **Update `functions/api/transcript.ts` to support `tlang` parameter**
  - New optional body param: `"translateTo": "es"` (target language code)
  - If `translateTo` is specified:
    - Find the source track (prefer manual, fallback to auto)
    - Append `&tlang={translateTo}` to the track's `baseUrl` before fetching
    - YouTube returns the translated transcript
  - Update response to include: `"translatedFrom": "en"`, `"translatedTo": "es"`
  - DoD: Requesting `translateTo: "es"` for an English video returns Spanish text with original timestamps.

- [ ] **Translation target selector in UI**
  - Second dropdown or button: "Translate to..."
  - Common languages at top: English, Spanish, French, German, Portuguese, Chinese, Japanese, Korean, Arabic, Hindi, Russian
  - Full ISO language list available via scroll
  - Shows loading state during translation fetch
  - DoD: User selects "Spanish" → transcript re-renders in Spanish. Original timestamps preserved.

- [ ] **Translation quality notice**
  - When viewing translated transcript, show subtle banner: "Translated by YouTube. Quality may vary."
  - DoD: Banner appears only for translated transcripts, not for natively available language tracks.

### Side-by-side bilingual view

- [ ] **Bilingual layout component**
  - Button: "Side by Side" (only enabled when viewing a translated transcript)
  - Two-column layout: original language left, translated right
  - Segments aligned by timestamp (each row = same time window)
  - Both columns scroll together (linked scroll)
  - Click-to-seek works from either column
  - DoD: Side-by-side shows original and translation aligned. Scrolling one column scrolls the other.

- [ ] **Bilingual export**
  - When in bilingual mode, export includes both languages
  - TXT: `[MM:SS] Original text | Translated text`
  - JSON: segments have `text` and `translatedText` fields
  - Markdown: two-column table or alternating blocks
  - DoD: Exported file contains both languages in a readable format.

---

## Export bar UI update

- [ ] **Reorganize export bar**
  - Group exports: `Copy | TXT | SRT | VTT | JSON | CSV | MD`
  - On narrow screens: overflow into a dropdown menu ("More formats...")
  - Show "Selection: 5 lines" indicator when range is selected
  - DoD: All 6 download buttons + copy visible on desktop. Overflow works on mobile. Selection indicator shows when active.

---

## Run 2 exit criteria

All boxes above checked, plus:

- [ ] Paragraph mode is the default view — transcript reads as coherent text, not caption fragments
- [ ] Three view modes work: Raw, Sentences, Paragraphs
- [ ] Click-to-seek jumps video to correct time
- [ ] Playback auto-scroll follows along during video playback
- [ ] All 6 export formats produce valid, correctly formatted files
- [ ] Range selection exports only selected segments
- [ ] Language switching loads different caption tracks
- [ ] YouTube auto-translate works via `tlang` parameter
- [ ] Side-by-side bilingual view shows both languages aligned
- [ ] Chapter headings appear for videos with chapters
- [ ] Deployed and tested on live site
