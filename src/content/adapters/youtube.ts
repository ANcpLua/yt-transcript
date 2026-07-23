export {};

const adapterGlobal = globalThis as typeof globalThis & {
  __videoTranscriptYouTubeAdapterInstalled?: boolean;
};

if (!adapterGlobal.__videoTranscriptYouTubeAdapterInstalled) {
  adapterGlobal.__videoTranscriptYouTubeAdapterInstalled = true;

const VIDEO_ID_RE = /[?&]v=([a-zA-Z0-9_-]{11})/;
const SHORTS_RE = /\/shorts\/([a-zA-Z0-9_-]{11})/;
const EMBED_RE = /\/embed\/([a-zA-Z0-9_-]{11})/;
const LIVE_RE = /\/live\/([a-zA-Z0-9_-]{11})/;

let lastVideoId: string | null = null;

function isExtensionAlive(): boolean {
  return Boolean(chrome.runtime?.id);
}

function safeSendMessage(message: unknown): void {
  if (!isExtensionAlive()) return;
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    if (error instanceof Error && !/Extension context invalidated/i.test(error.message)) {
      throw error;
    }
  }
}

function extractVideoId(url: string): string | null {
  for (const re of [VIDEO_ID_RE, SHORTS_RE, EMBED_RE, LIVE_RE]) {
    const match = re.exec(url);
    if (match?.[1]) return match[1];
  }
  return null;
}

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

type InnertubeClient = {readonly context: Record<string, unknown>};

const PAGE_CONTEXT_CLIENTS: readonly InnertubeClient[] = [
  {
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
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return false; }
  if (typeof parsed !== "object" || parsed === null) return false;
  const captions = (parsed as Record<string, unknown>)["captions"];
  if (typeof captions !== "object" || captions === null) return false;
  const renderer = (captions as Record<string, unknown>)["playerCaptionsTracklistRenderer"];
  if (typeof renderer !== "object" || renderer === null) return false;
  const tracks = (renderer as Record<string, unknown>)["captionTracks"];
  return Array.isArray(tracks) && tracks.length > 0;
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
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
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

function forwardInitialPlayerResponse(videoId: string): void {
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
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
}

function detectAndNotify(): void {
  const videoId = extractVideoId(window.location.href);
  if (!videoId || videoId === lastVideoId) return;
  lastVideoId = videoId;

  forwardInitialPlayerResponse(videoId);
}

detectAndNotify();

document.addEventListener("yt-navigate-finish", () => {
  lastVideoId = null;
  detectAndNotify();
});
}
