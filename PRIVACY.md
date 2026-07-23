# Privacy Policy

Video Transcript does not collect, sell, or transmit personal data to any
service operated by the project. The extension has no backend, accounts,
analytics, telemetry, advertising, or tracking SDK.

## Page access

Page inspection begins only after the user invokes the extension on an active
tab. Chrome's temporary `activeTab` permission is used to inspect media
elements, HTML text tracks, runtime text cues, and likely subtitle resources.
No content script runs permanently on every site.

The detector recognizes a bounded allowlist of timed-text URLs and MIME types.
Text response inspection is limited to 2 MiB per candidate. Data is parsed
locally and is never forwarded to the project or to an analytics service.

If a media player or caption resource lives on a cross-origin host, the
extension may offer an explicit Chrome permission prompt for the detected
origin. This permission is optional. Declining it leaves that native source
unavailable but does not enable any other data collection.

## Audio transcription

When the user explicitly selects live-audio transcription, Chrome captures the
active tab's audio and passes short PCM windows to Chrome built-in AI on the
device. Playback state and partial transcript text remain local.

Dropped audio or video files are decoded in the extension's offscreen document
and sent to the same on-device model. Files and audio samples are never
uploaded by the extension. Temporary blob URLs are revoked after completion,
failure, or cancellation.

## Local storage

- Recent transcript history and preferences use `chrome.storage`.
- Saved transcripts, highlights, notes, and tags use browser-local IndexedDB.
- Clearing extension data removes these local records.

## Network requests

The extension may request subtitle data from the media page or its delivery
origin while discovering a transcript. Optional bulk and page-adapter features
may request data from the source site after the user grants Chrome's site
permission. There are no cloud-AI, analytics, advertising, or project backend
requests.

## Open source

The source code is public and can be audited. Privacy questions can be raised
in the project's issue tracker.
