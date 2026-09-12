# Store privacy fields (Chrome Web Store and Edge Partner Center)

The dashboard asks these on every submission and does not carry the answers
forward reliably. Kept here so they are reviewed and versioned like the rest
of the listing, rather than retyped from memory under time pressure.

Rescued 2026-09-12 from the 2026-08-04 submission bundle, which was the only
copy.

## Fields

### SINGLE PURPOSE

Discover, transcribe, search, and export transcripts for user-selected media.

### SIDEPANEL JUSTIFICATION

Provides the extension's primary interface beside the selected media page,
where users can discover, read, search, annotate, process, save, and export
transcripts.

### ACTIVETAB JUSTIFICATION

Grants temporary access to the current tab only after the user invokes the
extension. This allows it to inspect the selected page's media elements, text
tracks, caption resources, title, and URL for transcript discovery and
timestamp seeking.

### SCRIPTING JUSTIFICATION

Injects bundled transcript-discovery scripts into a user-selected tab after
the toolbar action. These scripts inspect media elements, text tracks, and
bounded timed-text response candidates. No discovery script runs permanently
on every website.

### STORAGE JUSTIFICATION

Stores preferences, recent transcript history including source-page title and
URL, discovery state, saved transcripts, highlights, notes, and tags locally
using chrome.storage and IndexedDB. The extension does not request or store API
keys, and this information is not sent to the developer.

### TABCAPTURE JUSTIFICATION

Used only after the user explicitly selects live-audio transcription. It
captures audio from the selected tab so Chrome's built-in on-device AI can
transcribe media that has no readable captions. Audio is processed locally
and is not sent to the developer or a third-party AI service.

### OFFSCREEN JUSTIFICATION

Creates an offscreen document on demand for user-initiated live or file
transcription. Audio capture, decoding, AudioContext processing, and Chrome's
built-in on-device AI require document APIs that are unavailable in an
extension service worker.

### OPTIONAL HOST ACCESS

The current Chrome Web Store form does not present a separate justification
field for this package's optional_host_permissions declaration. Do not paste
an optional-host explanation into another permission field or the remote-code
field. Its on-demand, exact-origin behavior is disclosed in Privacy-Policy.md.

### REMOTE CODE

Select: No, I am not using remote code.

### DATA-USAGE CHECKBOXES

Check:
- Website content
- Web history

Leave the other data categories unchecked.

### LIMITED USE

Keep all three Limited Use certifications checked.

### PRIVACY-POLICY URL

https://gist.github.com/ANcpLua/8fb1ab3a839d008ef8fb4bd3a8a48adb

## Edge Partner Center

The Edge package is the Chromium build with `manifest.edge.json`, which
drops `tabCapture` and `offscreen` (from 3.2.2 on; 3.2.1 still declared them
and its justifications said the option is hidden). Partner Center asks the
same questions under "Privacy"; the answers below were checked against the
current manifest. Short on purpose: reviewers skim, and comparable extensions
with five-figure installs on the Edge store declare "no personal data
collected" with one-line justifications.

On-device transcription in Edge: the feature is offered only when the
browser's built-in model reports audio input as available
(`src/lib/ai/chrome-ai.ts` `isOnDeviceAudioAvailable`, gated again in
`src/sidepanel/App.tsx` `canTranscribeOnDevice`). Edge does not expose that
model with audio input, so the transcription entry points stay hidden there,
and the Edge manifest does not declare the two permissions at all.

### SINGLE PURPOSE DESCRIPTION

Show, search, and export the transcript of the video on the current page.
Uses captions the page already has; if there are none, transcribes the audio
on the device.

### SIDEPANEL JUSTIFICATION

The side panel is the extension's only UI. It shows the transcript next to
the video.

### ACTIVETAB JUSTIFICATION

Read the current tab's video captions after the user clicks the toolbar
button. One tab, one click, nothing stored or sent.

### SCRIPTING JUSTIFICATION

Injects the caption reader into the current tab after the toolbar click. No
content script runs on any site without that click.

### STORAGE JUSTIFICATION

Saves settings, recent transcripts, highlights and notes locally. Nothing is
synced or uploaded.

### REMOTE CODE

Select: No, I am not using remote code. Justification empty.

### DATA USAGE

Leave every category unchecked. Nothing is transmitted to the developer or a
third party; captions are fetched from the page's own caption host. This
matches the privacy policy and the declaration of comparable extensions on
the Edge store, which show "No personal data collected".

### PRIVACY POLICY URL

https://gist.github.com/ANcpLua/8fb1ab3a839d008ef8fb4bd3a8a48adb

### CERTIFICATIONS

Check all three.
