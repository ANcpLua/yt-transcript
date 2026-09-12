# Firefox reviewer build instructions

The submitted Firefox add-on is built entirely from this source archive. No
private dependencies, remote scripts, generated credentials, or proprietary
build tools are required.

## Environment

- Ubuntu 24.04 LTS or macOS
- Node.js 22.11 or newer (Vite, esbuild, and the unit tests run on it)
- Bun 1.4 or newer (package manager, https://bun.sh)
- `git` and `zip` available on `PATH`

## Reproduce the submitted add-on

From the directory containing `package.json`:

```sh
bun install --frozen-lockfile
bun run test
bun run zip
```

The Firefox package is written to `video-transcript-firefox-<version>.zip`,
where the version is the one in `manifest.json`. Its unpacked contents are
also available at `packages/extension/dist-firefox/`.

The build uses the versions locked in `bun.lock`. Vite and esbuild
bundle the React side panel, the background event-page script, and the
user-invoked caption discovery scripts. The Firefox output replaces the
Chromium manifest with `manifest.firefox.json` and omits Chromium-only
offscreen/tab-audio transcription files.
