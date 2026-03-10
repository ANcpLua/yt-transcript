import type { ApiError, Chapter, Segment, Track, TranscriptResponse } from "@/types/transcript";
import { parseChapters } from "@/lib/parseChapters";

export const INNERTUBE_PLAYER_URL =
  "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

export const INNERTUBE_BROWSE_URL =
  "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false";

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const ANDROID_UA =
  "com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip";

export interface PlayerClient {
  userAgent: string;
  headers: Record<string, string>;
  context: Record<string, unknown>;
}

export const PLAYER_CLIENTS: readonly PlayerClient[] = [
  {
    userAgent: ANDROID_UA,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": ANDROID_UA,
      "X-Goog-Api-Format-Version": "2",
    },
    context: {
      client: {
        clientName: "ANDROID",
        clientVersion: "21.03.36",
        androidSdkVersion: 36,
        userAgent: ANDROID_UA,
        hl: "en",
        gl: "US",
      },
    },
  },
  {
    userAgent: WEB_UA,
    headers: { "Content-Type": "application/json", "User-Agent": WEB_UA },
    context: { client: { clientName: "WEB", clientVersion: "2.20260301.00.00" } },
  },
];

export const CLIENT_CONTEXT = { client: { clientName: "WEB", clientVersion: "2.20260301.00.00" } };

export function dig(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const key of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function digStr(obj: unknown, path: string, fallback = ""): string {
  const v = dig(obj, path);
  return typeof v === "string" ? v : fallback;
}

export function digArr(obj: unknown, path: string): unknown[] {
  const v = dig(obj, path);
  return Array.isArray(v) ? v : [];
}

export function innertubeBrowse(body: Record<string, unknown>): Promise<Response> {
  return fetch(INNERTUBE_BROWSE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: CLIENT_CONTEXT, ...body }),
  });
}

interface InnertubeTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
}

interface InnertubeEvent {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
}

interface PlayerResult {
  title: string;
  captionTracks: InnertubeTrack[];
  shortDescription: string;
  userAgent: string;
}

function extractPlayerResult(raw: unknown, userAgent: string): PlayerResult | ApiError {
  const status = digStr(raw, "playabilityStatus.status");
  if (status === "ERROR") return { error: "invalid_id", message: "Video not found." };
  if (status === "LOGIN_REQUIRED" || status === "UNPLAYABLE")
    return { error: "unavailable", message: "This video is unavailable or private." };

  const captionTracks: InnertubeTrack[] = digArr(
    raw,
    "captions.playerCaptionsTracklistRenderer.captionTracks",
  )
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .filter((t) => typeof t["baseUrl"] === "string")
    .map((t) => ({
      baseUrl: t["baseUrl"] as string,
      languageCode: typeof t["languageCode"] === "string" ? t["languageCode"] : "",
      kind: typeof t["kind"] === "string" ? t["kind"] : undefined,
      name: t["name"] as InnertubeTrack["name"],
    }));

  return {
    title: digStr(raw, "videoDetails.title", "Untitled"),
    captionTracks,
    shortDescription: digStr(raw, "videoDetails.shortDescription"),
    userAgent,
  };
}

async function tryInnertubeClients(videoId: string): Promise<PlayerResult | ApiError> {
  let lastErr = "fetch_failed";
  let gotEmptyTracks = false;

  for (const client of PLAYER_CLIENTS) {
    let raw: unknown;
    try {
      const res = await fetch(INNERTUBE_PLAYER_URL, {
        method: "POST",
        headers: client.headers,
        body: JSON.stringify({ context: client.context, videoId }),
      });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      raw = await res.json();
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }

    const result = extractPlayerResult(raw, client.userAgent);
    if ("error" in result) {
      if (result.error === "unavailable" || result.error === "invalid_id") return result;
      lastErr = result.message;
      continue;
    }
    if (result.captionTracks.length > 0) return result;
    gotEmptyTracks = true;
  }

  if (gotEmptyTracks) return { error: "no_captions", message: "This video has no captions available." };
  return { error: "fetch_failed", message: lastErr };
}

async function scrapeWatchPage(videoId: string): Promise<PlayerResult | ApiError> {
  let html: string;
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": WEB_UA, "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!res.ok) return { error: "fetch_failed", message: `Watch page HTTP ${res.status}` };
    html = await res.text();
  } catch (e) {
    return { error: "fetch_failed", message: e instanceof Error ? e.message : String(e) };
  }

  const match = /var ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|const|let|<\/script>)/s.exec(html);
  if (!match) return { error: "fetch_failed", message: "Could not extract player response from watch page" };

  try {
    return extractPlayerResult(JSON.parse(match[1]!), WEB_UA);
  } catch {
    return { error: "fetch_failed", message: "Failed to parse embedded player response JSON" };
  }
}

async function resolvePlayer(videoId: string): Promise<PlayerResult | ApiError> {
  const result = await tryInnertubeClients(videoId);
  if ("error" in result && result.error === "fetch_failed") return scrapeWatchPage(videoId);
  return result;
}

function parseSegments(events: unknown[]): Segment[] {
  const segments: Segment[] = [];
  for (const ev of events) {
    if (typeof ev !== "object" || ev === null) continue;
    const event = ev as InnertubeEvent;
    const segs = event.segs;
    if (!Array.isArray(segs) || segs.length === 0) continue;
    const text = segs.map((s) => (typeof s.utf8 === "string" ? s.utf8 : "")).join("").trim();
    if (text.length === 0) continue;
    segments.push({ start: (event.tStartMs ?? 0) / 1000, duration: (event.dDurationMs ?? 0) / 1000, text });
  }
  return segments;
}

function getTrackName(track: InnertubeTrack): string {
  const name = track.name;
  if (!name) return track.languageCode;
  if (typeof name.simpleText === "string" && name.simpleText.length > 0) return name.simpleText;
  if (Array.isArray(name.runs)) {
    const combined = name.runs.map((r) => (typeof r.text === "string" ? r.text : "")).join("").trim();
    if (combined.length > 0) return combined;
  }
  return track.languageCode;
}

function mapTracks(captionTracks: InnertubeTrack[]): Track[] {
  return captionTracks.map((t) => ({ languageCode: t.languageCode, name: getTrackName(t), kind: t.kind }));
}

export async function fetchTranscript(
  videoId: string,
  lang?: string,
  translateTo?: string,
): Promise<TranscriptResponse | ApiError> {
  const player = await resolvePlayer(videoId);
  if ("error" in player) return player;

  const { title, captionTracks, shortDescription } = player;
  if (captionTracks.length === 0)
    return { error: "no_captions", message: "This video has no captions available." };

  const track = lang
    ? (captionTracks.find((t) => t.languageCode === lang) ?? captionTracks[0]!)
    : captionTracks[0]!;

  const language = track.languageCode;
  const textUrl = track.baseUrl + "&fmt=json3" + (translateTo && translateTo !== language ? `&tlang=${translateTo}` : "");

  let events: unknown[];
  try {
    const res = await fetch(textUrl, { headers: { "User-Agent": player.userAgent } });
    if (!res.ok) return { error: "fetch_failed", message: `Transcript fetch HTTP ${res.status}` };
    events = digArr(await res.json() as Record<string, unknown>, "events");
  } catch (e) {
    return { error: "fetch_failed", message: e instanceof Error ? e.message : String(e) };
  }

  const segments = parseSegments(events);
  if (segments.length === 0) return { error: "no_captions", message: "Transcript is empty." };

  const chapters: Chapter[] = parseChapters(shortDescription);
  const response: TranscriptResponse = {
    videoId,
    title,
    language: translateTo ?? language,
    isAutoGenerated: track.kind === "asr",
    tracks: mapTracks(captionTracks),
    segments,
    ...(chapters.length > 0 && { chapters }),
    ...(translateTo && translateTo !== language && { translatedFrom: language, translatedTo: translateTo }),
  };

  return response;
}

export async function fetchTracks(
  videoId: string,
): Promise<{ tracks: Track[]; title: string } | ApiError> {
  const player = await resolvePlayer(videoId);
  if ("error" in player) return player;

  const { title, captionTracks } = player;
  if (captionTracks.length === 0)
    return { error: "no_captions", message: "This video has no captions available." };

  return { tracks: mapTracks(captionTracks), title };
}
