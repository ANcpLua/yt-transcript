# Run 4: Bulk Operations + Polish + Ship

## Context (read this first if starting fresh)

**Project:** Free YouTube transcript extraction tool. Zero cost. No accounts. No paid APIs.

**Tech stack:** Vite + React + TypeScript + Tailwind CSS. Cloudflare Pages Functions for API proxy. Single deploy via `wrangler pages deploy dist/`.

**What already exists (Runs 1-3 completed):**
- Full extraction pipeline: URL → Innertube proxy → transcript with all view modes
- YouTube embedded player with click-to-seek, auto-scroll, segment highlighting
- All export formats: TXT, SRT, VTT, JSON, CSV, Markdown (with range selection)
- Language selection + YouTube auto-translate + side-by-side bilingual view
- Chapter-aware grouping
- BYOK AI: summary, key points, chapter summary, action items, quotes, chat — via OpenAI, Anthropic, or Google APIs (browser-direct)
- Local persistence: history (localStorage), saved transcripts (IndexedDB), highlights, notes, tags
- Preferences persistence
- Error handling for all known failure states
- Deployed to Cloudflare Pages

**After this run:** Bulk/playlist processing works. Additional AI outputs (blog outline, social posts, study notes, flashcards, SEO keywords, entity extraction). Notion/Obsidian copy formats. Filler word removal. Accessibility and performance audited. Production-ready.

---

## Bulk Operations

### Batch URL input

- [ ] **Batch input mode (`src/components/BatchInput.tsx`)**
  - Toggle or tab: "Single Video | Batch"
  - Batch mode: large textarea for pasting multiple URLs (one per line)
  - Parse all URLs on submit: extract video IDs, reject invalid lines with inline error markers
  - Show preview: list of parsed video IDs with titles (fetched via lightweight Innertube call or thumbnail existence check)
  - "Start Batch" button begins processing
  - Max 25 URLs per batch (display count and limit)
  - DoD: Paste 10 URLs → all parsed → preview shows 10 entries. Invalid URLs highlighted in red.

- [ ] **Batch processing queue (`src/lib/batch/queue.ts`)**
  - Process videos sequentially (not parallel — avoids rate limiting)
  - For each video:
    1. Fetch transcript
    2. Store result (success or error) in batch state
    3. Update progress
  - Rate: ~1 request per 1-2 seconds (configurable delay between fetches)
  - DoD: 10-video batch completes in ~15-30 seconds. Each result captured.

- [ ] **Batch progress UI**
  - Progress bar: "5 of 10 completed"
  - Per-video status: checkmark (success), X (failed), spinner (in progress), dash (pending)
  - Failed items show error reason (no captions, unavailable, etc.)
  - "Retry failed" button re-processes only failed items
  - "Cancel" button stops remaining items (keeps completed results)
  - DoD: Progress updates in real-time. Retry works. Cancel stops processing.

- [ ] **Batch results view**
  - After completion, show list of results
  - Click any result → view that transcript in the normal transcript viewer
  - Switch between transcripts without re-fetching (cached in memory during batch session)
  - DoD: All successful transcripts viewable. Switching is instant.

- [ ] **Batch export**
  - "Export All" button with format selector
  - Options:
    - **Separate files:** downloads a ZIP containing one file per video (in chosen format)
    - **Merged file:** single file with all transcripts concatenated, separated by video title headers
  - ZIP generation: use `fflate` npm package (lightweight, browser-only, no server)
  - Merged format example (TXT):
    ```
    === Video Title 1 ===
    [00:00] First segment...
    [00:05] Second segment...

    === Video Title 2 ===
    [00:00] First segment...
    ```
  - Markdown merged: each video is a `# Title` section
  - JSON merged: array of `TranscriptResponse` objects
  - DoD: ZIP download contains correct individual files. Merged file contains all transcripts with clear separators.

### Playlist extraction

- [ ] **Playlist URL detection**
  - Detect playlist URLs: `youtube.com/playlist?list=PLxxxxx` or `youtube.com/watch?v=xxx&list=PLxxxxx`
  - Extract playlist ID
  - DoD: Playlist URLs correctly identified and playlist ID extracted.

- [ ] **Fetch playlist videos (`functions/api/playlist.ts`)**
  - New Pages Function: GET `/api/playlist?id=PLxxxxx`
  - Uses Innertube `browse` endpoint to fetch playlist content:
    ```json
    POST https://www.youtube.com/youtubei/v1/browse
    Body: {
      "context": { "client": { "clientName": "WEB", "clientVersion": "..." } },
      "browseId": "VLPLxxxxx"
    }
    ```
  - Extracts video IDs, titles, and durations from playlist response
  - Handles pagination if playlist has many videos (continuationToken)
  - Returns: `{ playlistTitle: string, videos: { videoId: string, title: string, duration: string }[] }`
  - DoD: Returns complete video list for a known public playlist. Pagination works for playlists with 50+ videos.

- [ ] **Playlist UI flow**
  - When playlist URL detected:
    1. Show playlist title + video count
    2. List all videos with checkboxes (all checked by default)
    3. "Select All / Deselect All" toggle
    4. "Get Transcripts" button processes selected videos as a batch
  - Feeds into the batch processing queue (same as manual batch)
  - DoD: Playlist loads → user can select/deselect videos → batch processing runs on selected items.

### Channel extraction (lightweight)

- [ ] **Channel URL detection**
  - Detect: `youtube.com/@handle`, `youtube.com/channel/UCxxxxx`, `youtube.com/c/name`
  - Extract channel handle or ID
  - DoD: Channel URLs correctly identified.

- [ ] **Fetch recent channel videos (`functions/api/channel.ts`)**
  - New Pages Function: GET `/api/channel?handle=@xxx` or `?id=UCxxx`
  - Uses Innertube `browse` endpoint with channel tab
  - Returns last 30 videos (most recent uploads tab) — not full channel history
  - Response: `{ channelTitle: string, videos: { videoId: string, title: string, duration: string }[] }`
  - DoD: Returns recent videos for a known public channel.

- [ ] **Channel UI flow**
  - Same as playlist: show video list with checkboxes → batch process
  - Prominent note: "Showing 30 most recent uploads"
  - DoD: Channel URL → video list → selective batch processing works.

---

## Additional AI Features

### Content repurposing

- [ ] **Blog outline**
  - Button: "Blog Outline" in AI panel
  - Prompt: generate a structured blog post outline with H2/H3 headings, key points under each, and suggested intro/conclusion
  - Output: Markdown-formatted outline
  - "Copy as Markdown" button
  - DoD: Output is a usable blog outline structure, not just a summary with headers.

- [ ] **Social post drafts**
  - Button: "Social Posts" in AI panel
  - Generates 3 variants:
    - Twitter/X (280 char limit, engaging hook)
    - LinkedIn (professional tone, 1-2 paragraphs)
    - Short-form (Instagram/TikTok caption style)
  - Each variant has a "Copy" button
  - DoD: Each post fits its platform's tone and length. Copy works.

- [ ] **Study notes**
  - Button: "Study Notes" in AI panel
  - Structured output: key terms with definitions, main concepts, relationships between ideas
  - Formatted as organized Markdown with headers and bullet points
  - DoD: Notes are structured for learning, not just a summary rehash.

- [ ] **Flashcards**
  - Button: "Flashcards" in AI panel
  - Generates 10-20 Q&A pairs from transcript content
  - Display as flippable cards (click to reveal answer)
  - Export as:
    - Plain text (Q: ... A: ...)
    - CSV (question,answer — Anki import format)
    - JSON array of `{ question, answer }` objects
  - DoD: Flashcards test actual content knowledge. Export formats work for Anki import.

- [ ] **SEO keywords**
  - Button: "SEO Keywords" in AI panel
  - Extracts: primary topic keywords, long-tail phrases, related terms
  - Grouped by relevance (primary, secondary, related)
  - Comma-separated copy button for easy pasting into SEO tools
  - DoD: Keywords are specific to the video content, not generic.

- [ ] **Entity extraction**
  - Button: "Entities" in AI panel
  - Extracts: people mentioned, companies/products, tools/technologies, URLs/links, locations
  - Grouped by category
  - Each entity shows approximate timestamp where first mentioned (clickable)
  - DoD: Entities are real names/things from the transcript with timestamp references.

### AI bulk operations

- [ ] **Bulk AI action**
  - After batch processing, option: "Summarize All" or "Extract Keywords from All"
  - Runs the selected AI action on each transcript sequentially
  - Shows progress: "Summarizing 3 of 10..."
  - Results viewable per video or as a combined summary
  - DoD: Bulk AI processes all batch results. Combined output is coherent.

---

## Copy Formats for Note Tools

- [ ] **Notion-friendly copy**
  - Button: "Copy for Notion" in export bar
  - Format:
    - Video title as page title
    - Callout block with video URL and metadata
    - Toggle blocks for chapters (if available)
    - Bullet list for key segments
    - Timestamps as inline code: `` `03:45` ``
  - Notion pastes Markdown well, so format as Markdown with Notion-friendly conventions
  - DoD: Pasting into Notion produces a well-structured page with working formatting.

- [ ] **Obsidian-friendly copy**
  - Button: "Copy for Obsidian" in export bar
  - Format:
    ```markdown
    ---
    title: "Video Title"
    source: https://www.youtube.com/watch?v=xxx
    language: en
    date: 2026-03-10
    tags: [youtube, transcript]
    ---

    # Video Title

    **[00:00]** First paragraph of content...

    **[01:30]** Second paragraph...
    ```
  - YAML frontmatter for Obsidian metadata
  - Wikilinks for mentioned topics: `[[Topic Name]]` (optional, configurable)
  - DoD: Pasting into Obsidian creates a properly formatted note with frontmatter.

---

## Reading Experience Final Polish

### Filler word removal

- [ ] **Filler word filter (`src/lib/cleanText.ts`)**
  - Function: `removeFillersFromSegments(segments: Segment[], lang: string): Segment[]`
  - English fillers: "um", "uh", "er", "like" (when not meaningful), "you know", "I mean", "sort of", "kind of", "basically", "actually", "literally" (when filler), "right?"
  - Approach: regex-based removal with word boundary matching. Conservative — only remove when filler is standalone or at start/end of clause.
  - Multi-language: basic filler lists for Spanish ("este", "o sea"), French ("euh", "genre"), German ("ähm", "halt"). English as default.
  - DoD: Fillers removed without destroying sentence meaning. "I like dogs" keeps "like". "Like, I was going" removes "Like,".

- [ ] **Filler removal toggle in UI**
  - Toggle: "Clean fillers" (default OFF — show original first, let user choose)
  - When ON, applies filler removal to displayed text
  - Exports respect this toggle
  - DoD: Toggle removes fillers visually. Export with toggle ON produces cleaner text.

### Speaker labels

- [ ] **Speaker detection heuristics (`src/lib/detectSpeakers.ts`)**
  - Check caption metadata for speaker labels (some caption tracks include `[Speaker Name]:` prefixes)
  - Heuristic fallback: detect `>>` or `:` patterns at start of segments that indicate speaker changes
  - If detected, parse out speaker names and assign to segments
  - Type: `SegmentWithSpeaker extends Segment { speaker?: string }`
  - DoD: Videos with speaker labels in captions show speaker names. Videos without show no labels (no false positives).

- [ ] **Speaker labels in UI**
  - If speakers detected, show colored speaker name tag before segment text
  - Each speaker gets a consistent color
  - Filter by speaker: click speaker name to show only their segments
  - DoD: Speaker names visible with distinct colors. Filter works.

---

## Accessibility Audit

- [ ] **Keyboard navigation**
  - Tab order: URL input → submit → language dropdown → view mode selector → export buttons → transcript segments → AI panel
  - Enter/Space activates buttons and toggles
  - Escape closes modals/panels
  - Arrow keys navigate transcript segments (up/down)
  - Ctrl/Cmd+F focuses search input
  - DoD: Full app usable without mouse.

- [ ] **Screen reader support**
  - All interactive elements have `aria-label` or visible label
  - Transcript segments: `role="listitem"` within `role="list"`
  - Loading states: `aria-live="polite"` announcements
  - Error messages: `role="alert"`
  - Export buttons: clear labels ("Download as SRT subtitle file")
  - Search results: "12 matches found" announced on change
  - DoD: VoiceOver (macOS) reads all elements meaningfully. No unlabeled buttons.

- [ ] **Color contrast**
  - All text meets WCAG 2.1 AA contrast ratio (4.5:1 for normal text, 3:1 for large)
  - Highlighted segments readable against highlight background
  - Badges readable (auto-generated amber, manual green)
  - DoD: Pass automated contrast checker on all interactive states.

- [ ] **Focus indicators**
  - All focusable elements have visible focus ring
  - Focus ring removed only on mouse click (`:focus-visible`)
  - DoD: Tab through entire app — every element shows clear focus state.

- [ ] **Reduced motion**
  - Respect `prefers-reduced-motion: reduce`
  - Disable auto-scroll animation, smooth scrolling, transition effects
  - DoD: With reduced motion preference, no animations play.

---

## Performance Optimization

- [ ] **Virtualized transcript list**
  - For long transcripts (1000+ segments), use virtual scrolling
  - Only render segments visible in viewport + small buffer
  - Use `react-window` or `@tanstack/react-virtual`
  - DoD: 5000-segment transcript scrolls at 60fps. Memory usage stays constant regardless of transcript length.

- [ ] **Debounced search**
  - Search input debounced at 200ms (should already be implemented, verify)
  - Highlight rendering doesn't cause layout thrashing
  - DoD: Typing in search field on a 2000-segment transcript feels instant.

- [ ] **Code splitting**
  - AI panel loaded lazily (`React.lazy` + `Suspense`) — most users won't use AI
  - Batch processing components loaded lazily
  - Settings modal loaded lazily
  - DoD: Initial bundle doesn't include AI, batch, or settings code. These load on first access.

- [ ] **Asset optimization**
  - Vite build produces hashed filenames for cache busting
  - Tailwind purges unused classes in production build
  - No unnecessary dependencies (audit `node_modules` size)
  - Target: < 200KB gzipped total (excluding lazily-loaded chunks)
  - DoD: `npm run build` → check `dist/` size. Main bundle < 200KB gzipped.

---

## Trust, Legal, and UX Safeguards

- [ ] **Transparency notices**
  - Footer or "About" section:
    - "Transcripts are sourced from YouTube captions (creator-uploaded or auto-generated)."
    - "This tool does not store your data on any server. Everything stays in your browser."
    - "AI features use your own API key. We never see or store your key."
  - On auto-generated transcripts: persistent subtle banner "Auto-generated captions may contain errors"
  - DoD: Notices visible and accurate.

- [ ] **Privacy**
  - No analytics tracking (no Google Analytics, no Plausible, nothing)
  - No cookies set by our code
  - No data sent to any server except: YouTube (via our proxy for transcripts) and AI providers (directly from browser, only when user initiates)
  - DoD: Network tab shows zero requests to analytics/tracking domains.

- [ ] **Rate-limit protection**
  - Client-side throttle: max 1 transcript request per 2 seconds
  - Batch processing enforces delay between requests
  - If server returns 429, exponential backoff: 5s → 10s → 20s → show "Please wait" message
  - DoD: Rapid-fire clicks don't spam the API. 429 responses handled gracefully.

- [ ] **Terms and legal page**
  - Simple `/legal` page (can be a static route in the React app):
    - What data we process (YouTube URLs, transcripts in browser memory)
    - What we don't store (nothing server-side)
    - Third-party services (YouTube for transcripts, user-chosen AI provider)
    - GDPR: no personal data collected, no cookies, no tracking
    - Disclaimer: "Not affiliated with YouTube or Google"
  - Link in footer
  - DoD: Legal page exists, is accurate, and is linked from footer.

---

## Final Polish

- [ ] **Landing state (empty state)**
  - When app first loads (no video fetched yet):
    - Centered URL input
    - Brief tagline: "Extract, search, and export YouTube transcripts. Free. No signup."
    - 3-4 feature highlights with icons (Search, Export, AI, Languages)
    - "Paste a YouTube URL to get started"
  - Clean, inviting, not cluttered
  - DoD: First impression feels professional and trustworthy.

- [ ] **Loading skeleton**
  - While transcript loads, show animated skeleton that resembles the final layout
  - Skeleton for: title, metadata badges, transcript lines
  - DoD: Loading state feels fast and intentional, not broken.

- [ ] **Error recovery**
  - After any error, "Try Again" returns to a clean input state
  - Network connectivity loss shows offline banner with "Reconnecting..."
  - DoD: No dead-end states. User can always get back to a working state.

- [ ] **PWA basics (optional stretch)**
  - `manifest.json` with app name, icons, theme color
  - Basic service worker for offline access to saved transcripts
  - "Add to Home Screen" works on mobile
  - DoD: App installable on mobile. Saved transcripts accessible offline.

- [ ] **Open Graph / meta tags**
  - `<title>`: "YouTube Transcript Extractor — Free, No Signup"
  - `<meta name="description">`: "Extract, search, and export YouTube transcripts. All formats. AI-powered analysis. Free forever."
  - OG image (static, simple branded card)
  - DoD: Sharing the URL on social media shows a proper preview card.

---

## Production Deploy

- [ ] **Final build + deploy**
  - `npm run build` — no warnings, no errors
  - `npx wrangler pages deploy dist/` — deploys frontend + all functions
  - DoD: Live site at production URL.

- [ ] **Custom domain (if desired)**
  - Configure in Cloudflare Pages dashboard
  - Add CNAME record for custom domain
  - SSL automatic via Cloudflare
  - DoD: Custom domain resolves and serves the app with HTTPS.

- [ ] **End-to-end smoke test on production**
  - Single video: fetch → read → search → all view modes → all exports → click-to-seek
  - Bilingual: fetch → translate → side-by-side → export bilingual
  - AI: configure API key → summary → key points → chat → quotes
  - Batch: paste 5 URLs → process → export all as ZIP
  - Playlist: paste playlist URL → select videos → process → merged export
  - Mobile: full flow on a real phone
  - Accessibility: keyboard-only navigation through full flow
  - DoD: All flows work on the live production site.

---

## Run 4 exit criteria

All boxes above checked, plus:

- [ ] Batch processing handles 25 URLs with progress, retry, and cancel
- [ ] Playlist and channel extraction work for public content
- [ ] All AI features produce useful, transcript-grounded output
- [ ] Notion and Obsidian copy formats paste correctly into their respective apps
- [ ] Filler word removal works without destroying meaning
- [ ] Accessibility: full keyboard navigation, screen reader support, contrast compliance
- [ ] Performance: 5000-segment transcripts scroll smoothly, bundle < 200KB gzipped
- [ ] Privacy: zero tracking, zero cookies, zero server-side storage
- [ ] Legal page exists and is accurate
- [ ] Production deployed with all features working end-to-end
- [ ] The product genuinely beats youtube-transcript.io's free tier on every dimension
