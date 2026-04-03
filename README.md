# YouTube Transcript Extractor

[![Free](https://img.shields.io/badge/price-free-brightgreen)]()
[![Sponsor](https://img.shields.io/badge/sponsor-GitHub%20Sponsors-ea4aaa)](https://github.com/sponsors/ANcpLua)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)]()

Free browser extension that extracts, searches, and exports YouTube transcripts. Everything youtube-transcript.io charges $9.99/month for, this does for free.

No account. No credits. No server. No limits. No tracking.

## Features

- **Transcript extraction** from single videos, playlists, or channels
- **6 export formats**: TXT, SRT, VTT, JSON, CSV, Markdown (Notion + Obsidian)
- **AI tools**: summaries, quizzes, flashcards, mind maps, study guides, Q&A, sentiment analysis (BYOK or Chrome built-in AI)
- **Speaker detection** with colored labels and filtering
- **Chapter extraction** from video descriptions
- **Filler word removal** toggle
- **Transcript search**, highlights, and notes
- **Works offline** once fetched

## Install

| Store | Link |
|-------|------|
| Chrome Web Store | [Install](https://chromewebstore.google.com/) |
| Firefox Add-ons | [Install](https://addons.mozilla.org/) |
| Edge Add-ons | [Install](https://microsoftedge.microsoft.com/addons/) |

## Build from source

```bash
npm install
npm run build    # produces dist/
```

Load as unpacked extension: Chrome > `chrome://extensions` > Developer mode > "Load unpacked" > select `dist/`

## Privacy

Zero tracking. Zero analytics. Your data stays in your browser. API keys stored in `chrome.storage` only. AI requests go directly from your browser to your configured provider. There is no backend.

See [PRIVACY.md](PRIVACY.md) for full details.

## Support

This extension is free. No catch.

If you want to support me — I'm a student, I built this to replace a paid tool. Any amount helps.

[![Sponsor](https://img.shields.io/badge/sponsor-GitHub%20Sponsors-ea4aaa)](https://github.com/sponsors/ANcpLua)

You can also open a PR or file an issue — that's support too.

## Stack

React 19, Vite, Tailwind CSS 4, TypeScript (strict), MV3
