# Privacy Policy

**YouTube Transcript Extractor** does not collect, store, or transmit any personal data.

## What this extension does NOT do

- No user accounts or logins
- No analytics or tracking
- No cookies
- No data sent to any server
- No telemetry
- No third-party scripts that phone home

## Data storage

All data stays in your browser:

- **Transcripts**: Fetched from YouTube, stored temporarily in memory
- **API keys**: If you use AI features with your own API key, it is stored in `chrome.storage.local` on your device only. It is never sent anywhere except directly to the AI provider you configured (OpenAI, Anthropic, or Google).
- **History and saved transcripts**: Stored in your browser's IndexedDB. Never uploaded.
- **Preferences**: Stored in `chrome.storage.local`.

## Network requests

This extension only makes network requests to:

1. `youtube.com` — to fetch transcripts
2. `googlevideo.com` — YouTube's video infrastructure
3. Your configured AI provider (only if you set up an API key):
   - `api.openai.com`
   - `api.anthropic.com`
   - `generativelanguage.googleapis.com`

No other network requests are made. You can verify this in your browser's Developer Tools (Network tab).

## Open source

The full source code is available on GitHub. You can audit every line.

## Contact

For questions about this privacy policy, open an issue on GitHub.
