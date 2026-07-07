---
name: chrome-mv3-verify
description: Use when verifying the yt-transcript Chrome-only MV3 extension gate from this repository.
---

# Chrome MV3 Verification

Use this skill inside the `yt-transcript` repository when the goal is to verify
the local Chrome extension gate.

## Contract

- Run `pnpm verify` from the repository root.
- The gate must typecheck, build the Chrome extension, run unit tests, and run
  deterministic Playwright E2E.
- The Playwright tests load `packages/extension/dist-chrome`, derive the
  extension id from the MV3 service worker, and open
  `manifest.action.default_popup`.
- E2E media coverage uses only the local fixture server. Do not replace it with
  live YouTube, Vimeo, or non-Chrome browser coverage.
- Treat `playwright-report/e2e`, `test-results/e2e-results.json`, and
  `test-results/e2e-artifacts` as the first artifact locations to inspect on
  failure.
