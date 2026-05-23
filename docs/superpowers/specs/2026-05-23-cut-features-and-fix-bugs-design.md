# Cut features + fix four bugs + stabilize main

**Date:** 2026-05-23
**Branch:** `fix/innertube-timeouts-po-token-retry` → merge to `main`
**Author:** Claude (Opus 4.7) under direction from Alexander

## Problem

The extension has accumulated 18 AI features behind a 6-button "Essentials" + 12-item "More" drawer. Three are broken in user-visible ways, several are redundant, and the side panel locks up while any of them is running. The current branch is also a floating fix branch; the user wants the work landed on `main` and the branch retired.

User feedback (paraphrased): "this is madness, we don't need all that". Confirmed bugs:

1. **`Input is too large`** on long transcripts (e.g. Yu-Gi-Oh "Top 25 Rares") for Key points. Other features sometimes succeed because the model swallows the cap inconsistently.
2. **Q&A renders `**Q:**` and `**A:**` literally** with asterisks visible — markdown is not parsed.
3. **Timestamp clicks do nothing.** The button is wired but the message never reaches the YouTube tab.
4. **Feature lockdown:** every AI button disables when one is running, with no cancel — the user is held hostage by Chrome AI's spinner until completion.

## Goals (in priority order)

1. Cut AI feature surface from 18 → 4 (Summary, Key points, Q&A, Chat).
2. Fix the four bugs above.
3. Land everything on `main`, delete the feature branch.
4. Make AGENTS.md / CLAUDE.md truthful about what ships.

## Non-goals

- Reworking Whisper, the intercept-first transcript layer, or Innertube fallback. Those are working per the last branch.
- Cutting paid providers from Settings. The user didn't ask for that.
- Touching playlist/channel/CSV bulk extraction or export formats.
- Wiring `BilingualView.tsx`. It's deleted instead.

---

## 1. Feature cut

### Keep (4)

| Feature | Trigger | Why kept |
|---|---|---|
| Summary | Button | Headline feature; works on both videos the user tested. |
| Key points | Button | Distinct value from Summary (bullets vs. paragraph). Currently the bug victim. |
| Q&A (extract) | Button | Pulls direct timestamped answers — distinct from chat because it works without a question. |
| Chat ("Ask") | Bottom input box | Free-form. Replaces any feature we cut: if a user wants a mindmap they can ask for one. |

### Delete (14)

From `src/lib/ai/prompts.ts`:

```
quotes, chapterSummary, actionItems, sentiment, topics, mindmap,
studyGuide, studyNotes, qaGenerate, quiz, flashcards, blogOutline,
socialPosts, seoKeywords, entities
```

From `src/components/AiPanel.tsx`:

- `MORE_FEATURES` list
- `More`/`Less` toggle button and `showMore` state
- `FlashcardView` component and `flippedCards` state
- The flashcards branch in result rendering

From `src/types/transcript.ts`:

- Shrink `AiFeature` union to `"summary" | "bulletPoints" | "qaExtract"`. ("chat" is not an AiFeature — it has its own code path.)

### Also delete (unrelated dead code)

- `src/components/BilingualView.tsx` (227 lines, never imported by App.tsx — confirmed in CLAUDE.md "EXISTS / not wired").

### Preserve

- Chapter dividers in `TranscriptView.tsx` (data-driven from `parseChapters.ts`, not AI). The user value is the divider, not the AI summary of each chapter.
- Highlights / notes / speaker labels / filler-word removal — non-AI, no maintenance cost, no user complaint.

---

## 2. Bug: `Input is too large`

### Root cause

`src/lib/ai/prompts.ts:8-21`:

```ts
const TOKEN_LIMIT = 100_000;
const CHARS_PER_TOKEN = 4;
export function truncateTranscript(transcript: string): string {
  const maxChars = TOKEN_LIMIT * CHARS_PER_TOKEN;
  // ... 400 000 character cap
}
```

A single 400 000-character cap is applied to **every** provider. Chrome built-in AI's Prompt API has a context window in the low thousands of tokens (concretely it rejects with `Input is too large` once the input materially exceeds the per-session quota). Most YouTube transcripts of >30 min content blow past it.

### Fix

Replace `truncateTranscript(text)` with `truncateForProvider(text, kind)`:

```ts
type ProviderKind = "chrome-ai" | "ollama" | "paid";
const LIMITS: Record<ProviderKind, number> = {
  "chrome-ai": 6000,    // ~1.5K tokens, safely under Chrome AI's window
  ollama: 16000,        // local models vary; keep tight
  paid: 400000,         // current behavior
};
```

Plumb the resolved provider kind into each call site:

- `AiPanel.runFeature`: pass the kind down once `prefs.aiProvider` is resolved.
- `AiPanel.sendChat`: same.
- `getChatSystemPrompt`: takes a `kind` arg.

Each prompt template's `user(t)` signature becomes `user(t: string, kind: ProviderKind) => string`. Call site picks the kind, the template applies the cap.

### Side benefit

Once truncation is provider-correct, we can keep Chrome AI as the free-tier default without `Input is too large` surfacing to users at all — they just get a summary of the start+end of long transcripts with a `[... transcript truncated ...]` marker. That's already what `truncateTranscript` does for paid; we're just applying it at a sane cap for Chrome AI.

---

## 3. Bug: Q&A markdown not rendered

### Root cause

`src/components/AiPanel.tsx:93-112`:

```tsx
function RenderedContent({text, onSeek}) {
  const parts = text.split(TIMESTAMP_SPLIT_RE);
  return <div className="prose ... whitespace-pre-wrap">{parts.map(...)}</div>;
}
```

`whitespace-pre-wrap` shows the raw model output. `prose` styling is wasted because nothing emits `<h1>`, `<strong>`, `<ul>`, etc. The model is producing markdown (`**Q:**`, `**A:**`, numbered lists, bold) and we render it as plain text.

### Fix

Add two pure-JS dependencies (no telemetry, no network calls — audited):

- `react-markdown` (renders AST → React elements)
- `remark-gfm` (tables, strikethrough, autolinks)

Rewrite `RenderedContent` to:

1. Parse the body with `<ReactMarkdown>`.
2. Pass a custom `components` map for `p`, `li`, `td` etc. that post-processes child text and replaces `MM:SS` matches with clickable buttons.

Implementation sketch:

```tsx
function withTimestamps(text: string, onSeek: (t: number) => void): React.ReactNode[] {
  return text.split(TIMESTAMP_SPLIT_RE).map((part, i) =>
    TIMESTAMP_TEST_RE.test(part)
      ? <TimestampButton key={i} ts={part} onSeek={onSeek}/>
      : part
  );
}

const mdComponents: Components = {
  p: ({children}) => <p>{processChildren(children, onSeek)}</p>,
  li: ({children}) => <li>{processChildren(children, onSeek)}</li>,
  // td, th similar
};
```

The `prose dark:prose-invert` classes now have real semantic markup to style. The user gets bold Q/A labels, properly indented lists, and clickable timestamps.

### Bundle cost

`react-markdown@9` + `remark-gfm@4`: ~40 KB gzipped together. Acceptable for a side panel that already ships transformers.js.

---

## 4. Bug: Timestamp click does nothing

### Root cause

Flow today:

```
AiPanel button → onSeek(seconds)
              ↓
App.tsx handleSeek → chrome.runtime.sendMessage({type:"seek-to", time})
              ↓
Service worker onMessage listener — no "seek-to" case (service-worker.ts:45-)
              ↓
Content script content.ts:369 — has the listener, but NEVER RECEIVES.
```

`chrome.runtime.sendMessage` from an extension page (the side panel) is delivered to the service worker and other extension pages. **It does not reach content scripts.** To talk to a content script you must call `chrome.tabs.sendMessage(tabId, msg)`.

### Fix

Service worker forwards the message to the broadcasting tab. The SW already tracks the active YouTube tab via the correlator (used for `intercepted-transcript` broadcast).

`src/background/service-worker.ts`: in the existing `chrome.runtime.onMessage` listener (`:45`), add:

```ts
case "seek-to": {
  const tabId = correlator.broadcastingTabId();
  if (tabId !== null) {
    void chrome.tabs.sendMessage(tabId, message).catch(() => {});
  }
  return false;
}
```

`correlator.broadcastingTabId()` is a new accessor — `src/lib/intercept/correlator.ts` already has the data internally; we expose the current tab id with a one-line getter.

If no tab is currently broadcasting (e.g. user is browsing a non-YouTube tab while looking at a saved transcript), the click is a no-op — that's the correct outcome since there is no player to seek.

### Verify

In the manual-Chrome procedure, clicking a `[02:55]` timestamp in the side panel must scrub the player to 02:55. Confirmed by watching the YouTube progress bar move, not just by absence of console error.

---

## 5. Bug: Feature lockdown

### Root cause

`src/components/AiPanel.tsx:296-308`:

```tsx
<button disabled={!enabled || loading} ...>
```

While one request is running, every button is disabled. `runFeature` has no `AbortController`, so once you've pressed a button you wait it out. Image #4 shows the user stranded mid-`sentiment` with no way to switch to Q&A or cancel.

### Fix

Three changes in `AiPanel.tsx`:

1. **Drop `|| loading`** from `disabled`. The button just needs the provider to be available.

2. **Track an `AbortController`** in a ref. On `runFeature` entry:

   ```ts
   abortRef.current?.abort();
   abortRef.current = new AbortController();
   const signal = abortRef.current.signal;
   ```

   Pass `signal` into `sendAiRequest` and Chrome AI calls. Wrap the Chrome AI promise so an `abort` event causes the wrapper to `reject(new DOMException("Aborted","AbortError"))` and the result is discarded even if the underlying API doesn't natively cancel.

3. **Show a Stop link** next to "Analyzing…":

   ```tsx
   {loading && (
     <div className="flex items-center gap-2">
       <Spinner/>
       Analyzing…
       <button onClick={() => abortRef.current?.abort()}>Stop</button>
     </div>
   )}
   ```

4. In `catch`, distinguish `AbortError` (don't surface to UI; the user asked for it) from real errors.

5. **`sendAiRequest` cancellation:** `chrome.runtime.sendMessage` does not natively support `AbortSignal`. We add a `requestId` field, listen for an abort, and `chrome.runtime.sendMessage({type:"ai-abort", requestId})`. Service worker correlates and cancels the in-flight fetch via its own AbortController. If the SW round trip is slow (e.g. mid-`fetch` to OpenAI), this lets the user move on while the SW unwinds in the background.

### What the user experiences

Click Summary → spinner appears → user changes their mind, clicks Q&A → Summary is aborted, spinner stays for Q&A, Summary's network response is discarded. No lockdown.

### Also abort on new-transcript

In `App.tsx`, when `setTranscript` switches to a different video, the existing AbortController in `AiPanel` should also be aborted so a stale result from the old video can't appear in the panel of the new one. Use a `transcript.videoId`-keyed `useEffect` in `AiPanel` that calls `abortRef.current?.abort()`.

---

## 6. Stabilize main

The branch `fix/innertube-timeouts-po-token-retry` is `+237 / -1806` vs main (net deletion) and contains hardened transcript fixes. Strategy:

1. Land cuts + bug fixes as additional commits on this branch (3-5 small commits, one per concern, easier to revert individually if something breaks).
2. Run `npm run lint && npm run build`. Both must be green.
3. Manual verify in real Chrome per `AGENTS.md` "How to verify the extension actually works".
4. Push, open PR or fast-forward merge to `main` (user preference — solo-dev workflow, fast-forward is fine).
5. Delete the feature branch locally and on origin so `main` is the single source of truth.

### Docs to update in the same task

- `AGENTS.md`: rewrite the feature-parity table — delete F-007/F-008/F-011-F-017 rows; mark Bilingual EXTRA-004 as **REMOVED**. Replace the `ai_prompt_inventory` table with a 3-row truth. Drop the "Deferred / out of scope" Bilingual line. The pre-existing cosmetic line-wrap diff in AGENTS.md is absorbed into this rewrite.
- `CLAUDE.md`: mirror (or confirm it's still a symlink — verify in execution).
- `CHANGELOG.md`: append a dated entry under "Oldest first" ordering.

---

## Out-of-scope follow-ups (record, don't do)

- `Settings.tsx` is 896 lines. Most of it is paid-provider configuration the user didn't ask to cut. Leave alone.
- `TranscriptView.tsx` is 695 lines. Was on the "split if you touch" list. Not touched here.
- Whisper local transcription. Working per the last branch, no user complaint.

---

## Risks

| Risk | Mitigation |
|---|---|
| `react-markdown` interaction with timestamp post-processing breaks on edge text (e.g. timestamp inside `<code>`). | The `code` component renderer should NOT call `withTimestamps` — leave code blocks raw. Unit-test the helper against a sample with code blocks. |
| Provider-aware truncate breaks for users on Ollama with a large model (32k window). | The 16k cap is conservative. If users complain, add a `localModelContextWindow` preference to Settings. Mark with `[Δ: conservative path]` in the commit. |
| Service-worker forwarding of `seek-to` fails when the user paused the broadcasting tab. | Acceptable — clicking a timestamp on a saved transcript with no live tab is meaningfully a no-op. |
| Aborting Chrome AI mid-prompt may still consume the quota for that turn. | Documented as a "best-effort cancel" in code comment; user-facing behavior is identical (no UI lock). |

---

## Acceptance criteria

- 4 AI features visible in the panel, no More button.
- "Input is too large" no longer reproduces on the Yu-Gi-Oh "Top 25 Rares" video with Chrome AI as provider.
- Q&A output renders with bold Q/A labels, numbered list spacing, no literal `**`.
- Clicking `[02:55]` in any AI result scrubs the YouTube player to 2:55.
- Pressing a different feature mid-request immediately starts the new request and discards the previous.
- A Stop button is visible while a request runs.
- `npm run lint` and `npm run build` both pass with zero errors.
- `main` is the active branch, the feature branch is gone, AGENTS.md/CLAUDE.md/CHANGELOG.md are truthful.
