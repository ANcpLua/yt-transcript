# Privacy Policy

Effective date: August 4, 2026

Video Transcript processes only the information needed to provide
user-invoked transcript features. The project does not receive, sell, or share
this information. The extension has no backend, accounts, analytics,
telemetry, advertising, tracking SDK, API-key integration, or bundled machine
learning runtime.

## Information handled

Depending on the feature the user invokes, the extension may process:

- the selected page URL and title;
- media elements, playback state, text tracks, and timed-text resources;
- caption and transcript text;
- audio from the selected active tab when live transcription is explicitly
  started;
- audio or video files explicitly selected or dropped by the user;
- locally generated summaries, answers, notes, highlights, and tags; and
- preferences and recent transcript history.

This information is used only to discover, transcribe, display, search,
annotate, save, and export transcripts.

## Page access

Page inspection begins only after the user invokes the extension on an active
tab. Chrome's temporary `activeTab` permission is used to inspect media
elements, HTML text tracks, runtime text cues, and likely subtitle resources.
No content script runs permanently on every site.

The detector recognizes a bounded allowlist of timed-text URLs and MIME types.
Text response inspection is limited to 2 MiB per candidate. Data is parsed
locally and is never forwarded to the developer or an analytics service.

If a media player or caption resource uses another origin, the extension may
offer an explicit Chrome permission prompt for that exact origin. This
permission is optional. Declining it leaves that source unavailable and does
not enable any other data handling.

Specialized page-adapter and batch features request source-site access only
after the user invokes the relevant feature.

## Audio transcription

When the user explicitly starts live-audio transcription, Chrome captures the
selected tab's audio and passes short PCM windows to Chrome's built-in AI on
the device. Playback state, audio buffers, and partial transcript text remain
local.

Dropped or selected audio and video files are decoded inside the extension's
offscreen document and processed by the same on-device model. The extension
does not upload files or audio samples. Temporary blob URLs are revoked after
completion, failure, cancellation, or replacement.

## Local storage and retention

- Recent transcript history and preferences use `chrome.storage`.
- Discovery and live-transcription state use session storage.
- Saved transcripts, highlights, notes, and tags use browser-local IndexedDB.
- Temporary audio buffers are held only while needed for transcription.

Stored data remains in the user's browser until it is cleared through the
extension or Chrome, or until the extension is removed.

## Network requests

The extension may request subtitle data from the selected media page or its
caption-delivery origin. Optional batch and page-adapter features may request
data from a source site after the user grants access. These source services
may receive normal browser request information required to return the
requested resource. No request is sent to a server operated by the project,
and there are no cloud-AI, analytics, advertising, or tracking requests.

## Sharing and human access

The developer does not receive, sell, transfer, or permit human review of the
user's page data, audio, files, transcripts, history, notes, or preferences.

## Chrome Web Store Limited Use

Video Transcript's use of information received from Chrome APIs complies with
the Chrome Web Store User Data Policy, including the Limited Use requirements.
Information is used only to provide the extension's user-facing transcript
features. It is not sold, used for advertising or creditworthiness,
transferred for unrelated purposes, or made available for human review.

## Open source and contact

The source code is public and can be audited. Privacy questions can be raised
in the project's issue tracker:

https://github.com/ANcpLua/yt-transcript/issues

