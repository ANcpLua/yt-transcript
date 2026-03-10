# Run 3: BYOK AI Layer + Local Persistence

## Context (read this first if starting fresh)

**Project:** Free YouTube transcript extraction tool. Zero cost. No accounts. No paid APIs.

**Tech stack:** Vite + React + TypeScript + Tailwind CSS. Cloudflare Pages Functions for API proxy. Single deploy via `wrangler pages deploy dist/`.

**Zero-cost constraint for AI:** No server-side AI calls. User provides their own API key (BYOK = Bring Your Own Key). Keys stored in localStorage, never sent to our server. AI calls go directly from browser → provider API.

**What already exists (Run 1 + Run 2 completed):**
- Full extraction pipeline: URL → Innertube proxy → transcript display
- Three view modes: Raw, Sentences, Paragraphs
- YouTube embedded player with click-to-seek and playback auto-scroll
- All export formats: TXT, SRT, VTT, JSON, CSV, Markdown
- Range selection for partial export
- Language selection + YouTube auto-translate (`tlang` parameter)
- Side-by-side bilingual view
- Chapter-aware grouping
- Error handling for all known failure states
- Deployed to Cloudflare Pages

**After this run:** Users can bring their own AI API key to get summaries, key takeaways, and chat with the transcript. Transcripts are saved locally (localStorage/IndexedDB) with history, highlights, and notes.

---

## BYOK API Key Management

- [ ] **Settings panel component (`src/components/Settings.tsx`)**
  - Accessible via gear icon in the header/nav
  - Opens as a modal or slide-out panel
  - Sections: "AI Provider" and "Preferences"
  - DoD: Settings panel opens/closes cleanly. State persists across page reloads.

- [ ] **API key input and storage**
  - Provider selector: `OpenAI | Anthropic (Claude) | Google (Gemini)`
  - Text input for API key (password-masked by default, eye icon to reveal)
  - "Save" button stores key in `localStorage` under `yt-transcript:apiKey:{provider}`
  - "Clear" button removes the key
  - Key validation: on save, make a minimal API call (e.g., list models) to verify the key works
  - Show green checkmark on valid key, red X on invalid
  - **Security:** Keys never leave the browser. Never sent to our Cloudflare Functions. Never included in analytics or error reports.
  - Display notice: "Your API key is stored only in this browser. It is sent directly to {provider} and never touches our servers."
  - DoD: Key saved → persists across page reloads. Key cleared → fully removed from localStorage. Invalid key shows error.

- [ ] **Provider API configuration (`src/lib/ai/providers.ts`)**
  - Interface:
    ```ts
    interface AiProvider {
      name: string;
      sendMessage(params: {
        systemPrompt: string;
        userMessage: string;
        maxTokens?: number;
      }): Promise<string>;
    }
    ```
  - Implementations for each provider — browser-direct calls:
    - **OpenAI:** POST `https://api.openai.com/v1/chat/completions` with `Authorization: Bearer {key}`. Model: `gpt-4o-mini` (cheapest, good enough for summaries).
    - **Anthropic:** POST `https://api.anthropic.com/v1/messages` with `x-api-key: {key}` and `anthropic-dangerous-direct-browser-access: true` header. Model: `claude-haiku-4-5-20251001` (cheapest).
    - **Google Gemini:** POST `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}`. Model: `gemini-2.0-flash` (free tier available).
  - All calls made from browser via `fetch()` — CORS is supported by all three providers for API calls.
  - DoD: Each provider implementation sends a test message and receives a response. Error handling for auth failures, rate limits, network errors.

- [ ] **AI availability state**
  - Global state: `hasValidApiKey: boolean`
  - When no key configured: AI buttons show lock icon + "Add API key in Settings to enable AI features"
  - When key is configured: AI buttons are fully interactive
  - DoD: UI reflects key state correctly. No broken/hanging states.

---

## AI Features

### Prompt templates (`src/lib/ai/prompts.ts`)

- [ ] **Define prompt templates**
  - Each AI feature = a system prompt + user message template
  - User message always includes the full transcript text (or selected range)
  - System prompts are concise, instruction-focused:
    ```ts
    const PROMPTS = {
      summary: {
        system: "You are a transcript summarizer. Be concise and accurate. Only reference information present in the transcript.",
        user: (transcript: string) =>
          `Summarize this video transcript in 3-5 sentences:\n\n${transcript}`
      },
      bulletPoints: {
        system: "Extract key points as a bullet list. Be specific and factual. Only reference information in the transcript.",
        user: (transcript: string) =>
          `List the key points from this transcript as bullet points:\n\n${transcript}`
      },
      // ... etc for each feature
    }
    ```
  - Transcript is truncated if it exceeds model context limits (track token count approximately: chars / 4)
  - If transcript too long, truncate from the middle with `[... transcript truncated ...]` marker, keeping start and end
  - DoD: Each prompt template defined. Truncation logic works for long transcripts.

### AI panel component (`src/components/AiPanel.tsx`)

- [ ] **AI panel layout**
  - Appears below or beside the transcript (tab-based: "Transcript | AI")
  - Or: collapsible right sidebar on desktop, bottom sheet on mobile
  - Contains: quick action buttons + results area + chat input
  - DoD: Panel opens/closes. Responsive on desktop and mobile.

### Quick AI actions

- [ ] **One-click summary**
  - Button: "Summarize"
  - Sends full transcript (or selection) with summary prompt
  - Shows loading spinner while waiting for response
  - Renders result as plain text in the AI panel
  - DoD: Click → loading → summary appears. Summary is accurate to video content.

- [ ] **Bullet-point key takeaways**
  - Button: "Key Points"
  - Prompt asks for 5-10 bullet points
  - Renders as a bulleted list
  - DoD: Returns actionable, specific bullet points (not vague restatements).

- [ ] **Chapter summary**
  - Button: "Chapter Summary" (only visible when chapters detected)
  - Sends transcript segmented by chapters with instruction to summarize each
  - Renders as: chapter title → 1-2 sentence summary, for each chapter
  - DoD: Each chapter gets its own summary. Chapters without enough content get a shorter summary.

- [ ] **Action items**
  - Button: "Action Items"
  - Prompt: extract todos, recommendations, next steps mentioned in the video
  - Renders as a checklist-style list
  - If no action items found, says "No specific action items found in this video."
  - DoD: Returns concrete action items or a clear "none found" message.

- [ ] **Quote extraction**
  - Button: "Key Quotes"
  - Prompt: extract 3-7 notable/quotable passages with approximate timestamps
  - Each quote rendered with timestamp link (clickable → seeks video)
  - DoD: Quotes are actual transcript passages (not AI-generated paraphrases). Timestamps are approximate but reasonable.

- [ ] **AI result actions**
  - "Copy" button on each AI result
  - "Regenerate" button to re-run the same prompt
  - Results persist in component state (not lost when switching tabs)
  - DoD: Copy works. Regenerate produces a (potentially different) result. Switching between AI results doesn't lose previous ones.

### Ask-the-transcript chat

- [ ] **Chat interface**
  - Text input at bottom of AI panel: "Ask anything about this video..."
  - Send button (or Enter)
  - Chat history displayed as message bubbles (user question → AI answer)
  - System prompt includes the full transcript as context
  - AI answers should cite approximate timestamps: "At around 3:45, the speaker mentions..."
  - Timestamp references in AI responses are clickable (parsed via regex, linked to seek)
  - DoD: User asks a question → gets a relevant answer grounded in the transcript. Timestamps in answers are clickable.

- [ ] **Chat history management**
  - Messages accumulate in the conversation (sent as multi-turn to the API)
  - "Clear chat" button resets conversation
  - Conversation context = system prompt (with transcript) + all prior messages
  - If conversation grows too long for context window, drop oldest messages (keep system prompt + last N messages)
  - DoD: Multi-turn conversation works. Context management doesn't crash on long conversations.

- [ ] **Streaming responses (stretch — implement if time permits)**
  - Use streaming API endpoints (SSE for OpenAI/Anthropic, streaming for Gemini)
  - Render AI response token-by-token as it arrives
  - DoD: Response appears progressively instead of all-at-once. Loading feels faster.

---

## Local Persistence (localStorage + IndexedDB)

### Recent history

- [ ] **History storage (`src/lib/storage/history.ts`)**
  - On each successful transcript fetch, save to history:
    ```ts
    interface HistoryEntry {
      videoId: string;
      title: string;
      language: string;
      thumbnailUrl: string;     // https://img.youtube.com/vi/{id}/mqdefault.jpg
      fetchedAt: string;        // ISO timestamp
      segmentCount: number;
      wordCount: number;
    }
    ```
  - Store in `localStorage` under key `yt-transcript:history`
  - Max 50 entries (FIFO — oldest dropped when full)
  - DoD: Fetching a transcript adds it to history. History persists across page reloads.

- [ ] **History panel component (`src/components/History.tsx`)**
  - Accessible via clock/history icon in header
  - List of recent transcripts: thumbnail + title + language + date
  - Click entry → loads that video (re-fetches transcript — we don't cache full transcripts in history)
  - "Clear history" button with confirmation
  - DoD: History shows recent videos. Clicking re-fetches. Clear works.

### Saved transcripts

- [ ] **Save full transcript to IndexedDB (`src/lib/storage/saved.ts`)**
  - "Save" button (bookmark icon) in the transcript header
  - Saves complete transcript data to IndexedDB (localStorage is too small for many full transcripts):
    ```ts
    interface SavedTranscript {
      videoId: string;          // primary key
      title: string;
      language: string;
      isAutoGenerated: boolean;
      segments: Segment[];
      savedAt: string;
      highlights: number[];     // indices of highlighted segments
      notes: NoteEntry[];
      tags: string[];
    }
    ```
  - Use `idb` npm package (tiny IndexedDB wrapper) or raw IndexedDB API
  - DoD: Saving a transcript persists it. Reloading page and navigating to the same video shows "Saved" state.

- [ ] **Saved transcripts list**
  - Accessible via bookmark icon in header (separate from history)
  - Shows saved transcripts with title, language, date, tag pills
  - Click → loads transcript from IndexedDB (offline! no re-fetch needed)
  - Delete button per entry (with confirmation)
  - DoD: Saved list shows all saved transcripts. Clicking loads from local storage without network call.

### Highlights

- [ ] **Highlight transcript lines**
  - Click a highlight icon (or long-press on mobile) on any segment to toggle highlight
  - Highlighted segments get a persistent colored left border or background
  - Highlights stored in `SavedTranscript.highlights[]` as segment indices
  - Auto-saves transcript to IndexedDB when highlights change (must be a saved transcript first — prompt to save if not)
  - DoD: Highlight persists across page reloads. Removing highlight updates storage.

- [ ] **Export highlights only**
  - New export option: "Export Highlights"
  - Exports only highlighted segments in any format (TXT, MD, etc.)
  - DoD: Export contains only highlighted lines with their timestamps.

### Notes

- [ ] **Notes on transcript lines**
  - Click a note icon on any segment to add a note
  - Small text area appears inline below the segment
  - Note saved in `SavedTranscript.notes[]` as `{ segmentIndex: number, text: string, createdAt: string }`
  - Note icon shows filled state when a note exists
  - DoD: Add a note → it persists. Edit and delete work. Notes visible in transcript view.

- [ ] **Export with notes**
  - When exporting a saved transcript, optionally include notes
  - Markdown format: note appears as a blockquote below its segment
  - DoD: Exported markdown includes notes as `> Note: ...` blocks.

### Tags

- [ ] **Tag saved transcripts**
  - Tag input on saved transcript detail view
  - Comma-separated or chip-style input
  - Tags stored in `SavedTranscript.tags[]`
  - Filter saved list by tag
  - DoD: Tags added, persisted, filterable.

---

## Preferences persistence

- [ ] **Save user preferences to localStorage**
  - Key: `yt-transcript:preferences`
  - Preferences:
    ```ts
    interface Preferences {
      viewMode: "raw" | "sentences" | "paragraphs";   // default: "paragraphs"
      showTimestamps: boolean;                          // default: true
      compactMode: boolean;                             // default: false
      autoScroll: boolean;                              // default: true
      aiProvider: "openai" | "anthropic" | "google" | null;
    }
    ```
  - Load on app start, apply to all components
  - DoD: Changing a preference persists across page reloads.

---

## Storage management

- [ ] **Storage usage indicator**
  - In settings panel, show: "Local storage: X MB used"
  - Estimate: `navigator.storage.estimate()` for IndexedDB, `JSON.stringify(localStorage).length` for localStorage
  - Warning when approaching limits (> 80% of estimated quota)
  - DoD: Usage shown in settings. Warning appears when storage is high.

- [ ] **Export all + clear**
  - "Export all saved data" button in settings
  - Downloads a single JSON file with all saved transcripts, history, highlights, notes
  - "Clear all data" button with confirmation (removes localStorage + IndexedDB data)
  - DoD: Export produces valid JSON with all user data. Clear removes everything. Fresh state after clear.

---

## Run 3 exit criteria

All boxes above checked, plus:

- [ ] BYOK flow works: paste API key → save → AI buttons unlock → summaries generate
- [ ] All three providers (OpenAI, Anthropic, Google) work for at least summary + chat
- [ ] API keys never leave the browser (verify: no key in network requests to our domain)
- [ ] Ask-the-transcript chat returns answers grounded in video content with timestamp citations
- [ ] History shows last 50 videos, loads on click
- [ ] Saved transcripts load from IndexedDB without network (offline-capable for saved content)
- [ ] Highlights and notes persist across sessions
- [ ] Preferences persist across sessions
- [ ] Storage management: export all + clear all works
- [ ] Deployed and tested on live site
