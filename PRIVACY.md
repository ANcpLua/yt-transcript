# Privacy Policy

**YouTube Transcript Extractor** does not collect, store, or transmit any
personal data.

## What this extension does NOT do

- No user accounts or logins
- No analytics or tracking
- No cookies set by us
- No data sent to any server we run (we don't run any)
- No telemetry
- No third-party scripts that phone home

## Data storage

All data stays in your browser:

- **Transcripts**: Fetched from YouTube or Vimeo, kept in memory while the
  side panel is open. Optionally saved to your browser's IndexedDB if you
  click "Save".
- **API keys**: If you use AI features with your own key, the key is
  stored in `chrome.storage.local` on your device only. It is never sent
  anywhere except directly to the AI provider you configured (OpenAI,
  Anthropic, Google, or your local Ollama server).
- **History and saved transcripts**: Stored in IndexedDB. Never uploaded.
- **Preferences**: Stored in `chrome.storage.local`.

## Network interception scope

The extension installs a small script in the YouTube page's JavaScript
context that observes responses to a fixed allowlist of YouTube API
endpoints used for transcript data:

- `youtubei/v1/get_transcript`
- `youtubei/v1/player`
- `api/timedtext`

This is what lets us deliver a transcript instantly when you open a
YouTube video, including videos that YouTube otherwise gates behind
session tokens we cannot replicate from an extension. **No other YouTube
request or response is read, logged, or transmitted.** Bodies of
non-allowlisted responses are never even cloned. The full source for the
interceptor is in `src/content/yt-interceptor.ts` and `src/content/yt-bridge.ts`
on GitHub — you can audit every line.

## Network requests

The extension's outgoing network footprint:

1. `youtube.com` and `vimeo.com` — to fetch transcripts.
2. `huggingface.co` — only if you choose local Whisper transcription
   (the model weights stream from the Hugging Face CDN on first use and
   then cache locally; opt-in, never automatic).
3. Your configured AI provider, only if you set up an API key:
   - `api.openai.com`
   - `api.anthropic.com`
   - `generativelanguage.googleapis.com`
   - `localhost:11434` for Ollama (your machine, not ours)

No other network requests are made. You can verify this in your browser's
Developer Tools (Network tab).

## Open source

The full source code is available on GitHub. You can audit every line.

## Contact

For questions about this privacy policy, open an issue on GitHub.
