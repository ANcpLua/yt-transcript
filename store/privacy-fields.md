# Chrome Web Store privacy fields

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
