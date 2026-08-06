# Firefox reviewer build instructions

The submitted Firefox add-on is built entirely from this source archive. No
private dependencies, remote scripts, generated credentials, or proprietary
build tools are required.

## Environment

- Ubuntu 24.04 LTS or macOS
- Node.js 24.x
- npm 11.x
- `zip` available on `PATH`

## Reproduce the submitted add-on

From the directory containing `package.json`:

```sh
npm ci
npm test
npm run zip:firefox
```

The Firefox package is written to `video-transcript-firefox.zip`. Its unpacked
contents are also available at `packages/extension/dist-firefox/`.

The build uses the versions locked in `package-lock.json`. Vite and esbuild
bundle the React side panel, the background event-page script, and the
user-invoked caption discovery scripts. The Firefox output replaces the
Chromium manifest with `manifest.firefox.json` and omits Chromium-only
offscreen/tab-audio transcription files.
