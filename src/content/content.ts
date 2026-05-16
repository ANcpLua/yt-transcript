// YouTube ISOLATED-world content script (document_idle).
//
// 2026-05 update: modern YouTube watch pages no longer call
// /youtubei/v1/player — the player response is inlined into the
// document HTML as `var ytInitialPlayerResponse = {...}` and parsed
// by YouTube's bundle on the same page. The MAIN-world fetch
// interceptor was therefore catching only /api/timedtext (when
// captions auto-played) and missing the captionTrack baseUrls we
// need. This script revives the legacy DOM extraction path: it
// scrapes ytInitialPlayerResponse from the inline script tags and
// forwards it to the SW as a synthetic intercepted-capture so the
// correlator can auto-fetch the timedtext URL the same way it does
// for actual /youtubei/v1/player captures.
//
// Other duties: relay video currentTime, honour seek-to.

export {};

const VIDEO_ID_RE = /[?&]v=([a-zA-Z0-9_-]{11})/;
const SHORTS_RE = /\/shorts\/([a-zA-Z0-9_-]{11})/;
const EMBED_RE = /\/embed\/([a-zA-Z0-9_-]{11})/;
const LIVE_RE = /\/live\/([a-zA-Z0-9_-]{11})/;

let lastVideoId: string | null = null;
let playerTimeInterval: ReturnType<typeof setInterval> | null = null;

function isExtensionAlive(): boolean {
  return Boolean(chrome.runtime?.id);
}

function shutdown(): void {
  if (playerTimeInterval) {
    clearInterval(playerTimeInterval);
    playerTimeInterval = null;
  }
}

function safeSendMessage(message: unknown): void {
  if (!isExtensionAlive()) {
    shutdown();
    return;
  }
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      (result as Promise<unknown>).catch(() => {});
    }
  } catch {
    shutdown();
  }
}

function extractVideoId(url: string): string | null {
  for (const re of [VIDEO_ID_RE, SHORTS_RE, EMBED_RE, LIVE_RE]) {
    const match = re.exec(url);
    if (match?.[1]) return match[1];
  }
  return null;
}

// Pull the inline `var ytInitialPlayerResponse = {...}` blob out of
// the page. We can't reach window.ytInitialPlayerResponse directly
// because that lives in MAIN world; the inline script tag's text is
// readable from ISOLATED world.
function extractInitialPlayerResponse(): string | null {
  const re = /var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var|const|let|<\/script>|window\[)/s;
  for (const script of document.querySelectorAll<HTMLScriptElement>("script:not([src])")) {
    const text = script.textContent;
    if (!text || !text.includes("ytInitialPlayerResponse")) continue;
    const m = re.exec(text);
    if (m?.[1]) return m[1];
  }
  return null;
}

// Call /youtubei/v1/player from the page's youtube.com origin. We try
// a series of mobile/embedded clients in order; the inline DOM
// ytInitialPlayerResponse (WEB client) ships `exp=xpe`-gated caption
// URLs that return HTTP 200 + 0 bytes, and from `chrome-extension://`
// these endpoints are 403'd outright. From the youtube.com origin
// these clients return non-PO-token-gated captionTrack URLs that
// serve real bodies.
//
// Why an array, not a single client:
//   - ANDROID_VR covers most videos with human/uploaded captions.
//   - IOS covers ASR-only videos where ANDROID_VR returns an empty
//     captionTracks array (observed on 6e9B7q3gvYY — Microservices
//     Scam; ANDROID_VR ⇒ 0 tracks, IOS ⇒ 1 ASR track that fetches
//     to a parseable 632-event json3 body).
// Stop on the first client that returns a non-empty captionTracks.
type InnertubeClient = {readonly name: string; readonly context: Record<string, unknown>};

const PAGE_CONTEXT_CLIENTS: readonly InnertubeClient[] = [
  {
    name: "ANDROID_VR",
    context: {
      client: {
        clientName: "ANDROID_VR",
        clientVersion: "1.62.27",
        androidSdkVersion: 32,
        deviceMake: "Oculus",
        deviceModel: "Quest 3",
        osName: "Android",
        osVersion: "12L",
        hl: "en",
        gl: "US",
      },
    },
  },
  {
    name: "IOS",
    context: {
      client: {
        clientName: "IOS",
        clientVersion: "20.10.4",
        deviceMake: "Apple",
        deviceModel: "iPhone16,2",
        osName: "iOS",
        osVersion: "18.5.1.22F76",
        hl: "en",
        gl: "US",
      },
    },
  },
];

function playerHasCaptionTracks(body: string): boolean {
  try {
    const j = JSON.parse(body) as {captions?: {playerCaptionsTracklistRenderer?: {captionTracks?: unknown[]}}};
    return Array.isArray(j?.captions?.playerCaptionsTracklistRenderer?.captionTracks)
      && (j.captions!.playerCaptionsTracklistRenderer!.captionTracks!.length > 0);
  } catch {
    return false;
  }
}

async function fetchPageContextPlayer(videoId: string): Promise<string | null> {
  for (const client of PAGE_CONTEXT_CLIENTS) {
    try {
      const res = await fetch("/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        credentials: "include",
        body: JSON.stringify({
          context: client.context,
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!res.ok) continue;
      const body = await res.text();
      if (playerHasCaptionTracks(body)) return body;
    } catch {
      // try next client
    }
  }
  return null;
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text?: string }[] };
}

function pickCaptionTrack(playerJson: string): CaptionTrack | null {
  let parsed: unknown;
  try { parsed = JSON.parse(playerJson); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null) return null;
  const root = parsed as Record<string, unknown>;
  const tracks = ((root["captions"] as Record<string, unknown> | undefined)
    ?.["playerCaptionsTracklistRenderer"] as Record<string, unknown> | undefined)
    ?.["captionTracks"];
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  // Prefer the original audio track. YouTube orders captionTracks by the
  // user's UI locale, so tracks[0] is whatever Firefox/Chrome's locale
  // requested (a translation, in most cases). The original is whichever
  // matches videoDetails.defaultAudioLanguage; fall back to any track
  // with kind === "asr" (the source ASR), then to the first track.
  const defaultLang = (((root["videoDetails"] as Record<string, unknown> | undefined)
    ?.["defaultAudioLanguage"]) as string | undefined)?.split("-")[0]?.toLowerCase();

  if (defaultLang) {
    const original = tracks.find((t) => {
      const o = t as Record<string, unknown>;
      return typeof o["languageCode"] === "string"
        && (o["languageCode"] as string).toLowerCase().startsWith(defaultLang);
    });
    if (original) return original as CaptionTrack;
  }
  const asr = tracks.find((t) => (t as Record<string, unknown>)["kind"] === "asr");
  return (asr ?? tracks[0]) as CaptionTrack;
}

// Forward a synthetic player capture to the SW. The correlator
// already knows how to record this kind from the MAIN-world
// interceptor — both paths funnel through buildPlayerSnapshot.
//
// In the same step, we fetch the captionTrack baseUrl from the
// content script's own fetch() which inherits the page's cookies +
// visitor data + PO token. The SW's chrome-extension:// origin
// doesn't have those, so its fetch returns 0 bytes for `&exp=xpe`-
// signed URLs. By fetching here and forwarding the body as a
// timedtext capture, the correlator gets segments without the SW
// ever needing to make the cross-origin call.
function forwardInitialPlayerResponse(videoId: string): void {
  // Two parallel sources of captionTracks:
  //   Mobile/embedded clients — page-context fetch of
  //     /youtubei/v1/player cycling through ANDROID_VR then IOS (see
  //     PAGE_CONTEXT_CLIENTS). yt-dlp's go-to chain for anonymous
  //     extraction: returns caption URLs signed WITHOUT `exp=xpe` in
  //     `sparams`, so /api/timedtext serves real bodies without a PO
  //     token. SW-context fetches of the same endpoint get 403'd from
  //     `chrome-extension://`; running the request inside content.js
  //     puts the call on the youtube.com origin where YouTube accepts
  //     it. ANDROID_VR covers most videos; IOS picks up ASR-only
  //     videos that ANDROID_VR returns as an empty captionTracks
  //     array. This is the path that actually delivers captions for
  //     anonymous viewers.
  //   DOM `ytInitialPlayerResponse` — inline blob YouTube ships in the
  //     watch-page HTML. Its captionTrack baseUrls have `exp=xpe` in
  //     sparams (returns 0-byte for anonymous) but the player payload
  //     itself still carries chapters, description, title, etc., so we
  //     forward it for the correlator to read those side-channel
  //     fields. The non-gated URLs from the mobile clients replace
  //     its tracks.
  void (async () => {
    const playerJson = await fetchPageContextPlayer(videoId);
    if (!playerJson) return;
    safeSendMessage({
      type: "intercepted-capture",
      kind: "player",
      videoId,
      url: `page-ctx://${videoId}`,
      status: 200,
      bodyText: playerJson,
    });
    void fetchTimedTextFromPage(videoId, playerJson);
  })();

  let domTries = 0;
  const tryOnce = () => {
    domTries++;
    const json = extractInitialPlayerResponse();
    if (json) {
      safeSendMessage({
        type: "intercepted-capture",
        kind: "player",
        videoId,
        url: `dom://${videoId}`,
        status: 200,
        bodyText: json,
      });
      void fetchTimedTextFromPage(videoId, json);
      return;
    }
    if (domTries < 6) setTimeout(tryOnce, 500);
  };
  tryOnce();
}

async function fetchTimedTextFromPage(videoId: string, playerJson: string): Promise<void> {
  const track = pickCaptionTrack(playerJson);
  if (!track) return;
  // Force fmt=json3 — YouTube signs the URL over `sparams`, and fmt is
  // never in sparams, so an explicit append is accepted regardless of
  // what the client embedded. Without it the endpoint defaults to
  // legacy XML which `parseGetTranscript` doesn't speak.
  const sep = track.baseUrl.includes("?") ? "&" : "?";
  const url = `${track.baseUrl}${sep}fmt=json3`;
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return;
    const bodyText = await res.text();
    if (!bodyText) return;
    safeSendMessage({
      type: "intercepted-capture",
      kind: "timedtext",
      videoId,
      url,
      status: res.status,
      bodyText,
    });
  } catch {
    // network blocked — interceptor may still catch YouTube's own fetches.
  }
}

// Programmatically open YouTube's own transcript panel. Clicking
// the "Show transcript" affordance forces the page to fetch
// /youtubei/v1/get_transcript with the session's full PO token, which
// our MAIN-world interceptor then catches. Necessary because the
// engagement-panel captionTrack baseUrls have started shipping with
// `&exp=xpe` (the PoTokenRequired empty-body signal) baked into the
// signed URL — we can't strip it without breaking the signature.
function autoOpenTranscriptPanel(): void {
  let attempts = 0;
  const tick = () => {
    attempts++;
    if (clickShowTranscript()) {
      return;
    }
    if (attempts < 12 && isExtensionAlive()) {
      setTimeout(tick, 750);
    }
  };
  tick();
}

function clickShowTranscript(): boolean {
  // Newer surface: dedicated transcript section in the description.
  const direct = document.querySelector<HTMLElement>(
    'ytd-video-description-transcript-section-renderer button, ytd-video-description-transcript-section-renderer ytd-button-renderer',
  );
  if (direct) {
    direct.click();
    return true;
  }
  // Fallback: scan every button for the localized "Show transcript".
  // YouTube ships the same aria-label in many languages, so we check
  // both the visible text and aria-label.
  const SHOW_TRANSCRIPT_RE = /\b(show transcript|transcript|transkript|transcripción|transcrição|trascrizione|文字起こし|字幕|стенограмма)\b/i;
  for (const el of document.querySelectorAll<HTMLElement>("button, tp-yt-paper-button, yt-button-shape")) {
    const aria = el.getAttribute("aria-label") || "";
    const text = (el.textContent || "").trim();
    if (SHOW_TRANSCRIPT_RE.test(aria) || (text.length < 60 && SHOW_TRANSCRIPT_RE.test(text))) {
      el.click();
      return true;
    }
  }
  return false;
}

function detectAndNotify(): void {
  const videoId = extractVideoId(window.location.href);
  if (!videoId || videoId === lastVideoId) return;
  lastVideoId = videoId;

  safeSendMessage({ type: "video-detected", videoId, platform: "youtube" });
  forwardInitialPlayerResponse(videoId);
  autoOpenTranscriptPanel();

  if (playerTimeInterval) clearInterval(playerTimeInterval);
  playerTimeInterval = setInterval(() => {
    if (!isExtensionAlive()) {
      shutdown();
      return;
    }
    const video = document.querySelector("video");
    if (video && !video.paused) {
      safeSendMessage({ type: "player-time", currentTime: video.currentTime });
    }
  }, 1000);
}

detectAndNotify();

document.addEventListener("yt-navigate-finish", () => {
  lastVideoId = null;
  detectAndNotify();
});

if (isExtensionAlive()) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "seek-to") {
      const video = document.querySelector("video");
      if (video) video.currentTime = message.time;
      return false;
    }
    return false;
  });
}
