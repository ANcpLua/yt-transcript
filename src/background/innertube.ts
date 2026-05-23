// Innertube fallback path.
//
// In the bleeding-edge architecture this only runs when the user pastes a
// URL for a video they're not actively watching — i.e. when there is no
// open YouTube watch tab for the MAIN-world interceptor to ride. For
// videos the user *is* watching, src/lib/intercept/* delivers a
// transcript without ever calling these endpoints.
//
// The chain is two layers:
//   - WEB_EMBEDDED_PLAYER (no PO token requirement per yt-dlp wiki)
//   - watch-page HTML scrape (last resort)
//
// The legacy "page DOM extraction by content script" path is gone —
// the interceptor replaces it.

import type { ApiError, Chapter, Segment, Track, TranscriptResponse } from "@/types/transcript";
import { parseChapters } from "@/lib/parseChapters";

export const INNERTUBE_PLAYER_URL =
  "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

export const INNERTUBE_BROWSE_URL =
  "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false";

// Hard timeouts on every YouTube fetch. Without these a single hanging
// endpoint blocks the entire client-fallback cascade and the UI spins
// forever — that was the user-reported "times out / hangs". YouTube's
// edge typically responds in <2s; 12s covers tail latency without
// making real failures feel infinite. Watch-page scrape and timedtext
// get a larger budget because their payloads are bigger.
//
// Override via globalThis.__YT_FETCH_TIMEOUT_MS (set from SW devtools)
// when chasing a slow-server issue.
export const PLAYER_TIMEOUT_MS = 12_000;
export const TIMEDTEXT_TIMEOUT_MS = 20_000;
export const WATCH_PAGE_TIMEOUT_MS = 20_000;

function timeoutSignal(ms: number): AbortSignal {
  const override = (globalThis as { __YT_FETCH_TIMEOUT_MS?: number }).__YT_FETCH_TIMEOUT_MS;
  return AbortSignal.timeout(typeof override === "number" && override > 0 ? override : ms);
}

function isTimeoutError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
}

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const ANDROID_VR_UA =
  "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";

// Innertube clients we cycle through, in the order `resolvePlayer`
// tries them: ANDROID_VR first, then TVHTML5_SIMPLY_EMBEDDED_PLAYER,
// then WEB_EMBEDDED_PLAYER. yt-dlp uses ANDROID_VR (and tv_simply via
// TV) as its current default for unauthenticated extraction because
// neither client needs PO tokens for player or subs as of 2025-Q4 —
// importantly, ANDROID_VR's captionTrack baseUrls do NOT include
// `exp=xpe` in `sparams`, so /api/timedtext returns real bytes
// instead of the 0-byte PoTokenRequired signal that WEB_EMBEDDED_PLAYER
// triggers. WEB_EMBEDDED_PLAYER stays in the chain as a final fallback
// for the rare video where ANDROID_VR returns nothing.
const EMBEDDED_CLIENT = {
  name: "WEB_EMBEDDED_PLAYER",
  userAgent: WEB_UA,
  headers: { "Content-Type": "application/json", "User-Agent": WEB_UA },
  context: {
    client: {
      clientName: "WEB_EMBEDDED_PLAYER",
      clientVersion: "1.20260330.00.00",
    },
    thirdParty: { embedUrl: "https://www.youtube.com" },
  },
} as const;

const TV_SIMPLY_CLIENT = {
  name: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
  userAgent: WEB_UA,
  headers: { "Content-Type": "application/json", "User-Agent": WEB_UA },
  context: {
    client: {
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      hl: "en",
      gl: "US",
      utcOffsetMinutes: 0,
    },
    thirdParty: { embedUrl: "https://www.youtube.com" },
  },
} as const;

const ANDROID_VR_CLIENT = {
  name: "ANDROID_VR",
  userAgent: ANDROID_VR_UA,
  headers: {
    "Content-Type": "application/json",
    "User-Agent": ANDROID_VR_UA,
    "X-Goog-Api-Format-Version": "2",
  },
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
      userAgent: ANDROID_VR_UA,
    },
  },
} as const;

export const CLIENT_CONTEXT = { client: { clientName: "WEB", clientVersion: "2.20260330.00.00" } };

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
    signal: timeoutSignal(PLAYER_TIMEOUT_MS),
  });
}

interface InnertubeTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string; runs?: { text?: string }[] };
}

interface InnertubeEvent {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: { utf8?: string }[];
}

export interface PlayerResult {
  title: string;
  captionTracks: InnertubeTrack[];
  shortDescription: string;
  userAgent: string;
}

// Used by both the SW fallback path and the intercept correlator.
export function extractPlayerResult(raw: unknown, userAgent: string): PlayerResult | ApiError {
  const status = digStr(raw, "playabilityStatus.status");
  if (status === "ERROR") return { error: "invalid_id", message: "Video not found." };
  if (status === "LOGIN_REQUIRED")
    return { error: "unavailable", message: "This video requires login." };
  if (status === "UNPLAYABLE") {
    const reason = digStr(raw, "playabilityStatus.reason");
    return { error: "fetch_failed", message: reason || "Video is unplayable with this client." };
  }

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

interface InnertubeClient {
  readonly name: string;
  readonly userAgent: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly context: Readonly<Record<string, unknown>>;
}

async function callPlayer(
  videoId: string,
  client: InnertubeClient,
): Promise<PlayerResult | ApiError> {
  let raw: unknown;
  try {
    const res = await fetch(INNERTUBE_PLAYER_URL, {
      method: "POST",
      headers: client.headers,
      body: JSON.stringify({
        context: client.context,
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: timeoutSignal(PLAYER_TIMEOUT_MS),
    });
    if (!res.ok) return { error: "fetch_failed", message: `HTTP ${res.status} from ${client.name}` };
    raw = await res.json();
  } catch (e) {
    if (isTimeoutError(e)) {
      return { error: "fetch_failed", message: `${client.name} timed out after ${PLAYER_TIMEOUT_MS}ms` };
    }
    return { error: "fetch_failed", message: e instanceof Error ? e.message : String(e) };
  }
  return extractPlayerResult(raw, client.userAgent);
}

async function scrapeWatchPage(videoId: string): Promise<PlayerResult | ApiError> {
  let html: string;
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": WEB_UA, "Accept-Language": "en-US,en;q=0.9" },
      signal: timeoutSignal(WATCH_PAGE_TIMEOUT_MS),
    });
    if (!res.ok) return { error: "fetch_failed", message: `Watch page HTTP ${res.status}` };
    html = await res.text();
  } catch (e) {
    if (isTimeoutError(e)) {
      return { error: "fetch_failed", message: `Watch page scrape timed out after ${WATCH_PAGE_TIMEOUT_MS}ms` };
    }
    return { error: "fetch_failed", message: e instanceof Error ? e.message : String(e) };
  }

  const match = /var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|const|let|<\/script>)/s.exec(html);
  if (!match) return { error: "fetch_failed", message: "Could not extract player response from watch page" };

  try {
    return extractPlayerResult(JSON.parse(match[1]!), WEB_UA);
  } catch {
    return { error: "fetch_failed", message: "Failed to parse embedded player response JSON" };
  }
}

function isUsablePlayer(result: PlayerResult | ApiError): result is PlayerResult {
  if ("error" in result) return false;
  return result.captionTracks.length > 0;
}

async function resolvePlayer(videoId: string): Promise<PlayerResult | ApiError> {
  // Try clients in order. Stop on the first hit that has captionTracks.
  // ANDROID_VR is intentionally first: its captionTrack baseUrls are
  // signed WITHOUT `exp=xpe` in `sparams`, so YouTube returns real
  // bodies without a PO token. WEB_EMBEDDED_PLAYER returns identical
  // captionTracks but with `exp=xpe` in the signed params, which
  // currently makes /api/timedtext respond `HTTP 200` + 0 bytes
  // (the "PO token required" signal) — that broke every paste-URL
  // fetch attempt for several months. Keep TV_SIMPLY and the
  // watch-page scrape as additional fallbacks for the rare video
  // where ANDROID_VR returns nothing.
  const clients: InnertubeClient[] = [ANDROID_VR_CLIENT, TV_SIMPLY_CLIENT, EMBEDDED_CLIENT];
  let lastError: ApiError | null = null;
  let captionlessHit: PlayerResult | null = null;

  for (const client of clients) {
    const result = await callPlayer(videoId, client);
    if (isUsablePlayer(result)) return result;
    if ("error" in result) {
      if (result.error === "invalid_id") return result;
      lastError = result;
      continue;
    }
    // Playable but no captions — try the next client (some clients
    // return empty caption arrays for the same video that another
    // surfaces fully).
    captionlessHit = result;
  }

  // Watch-page scrape as last Innertube-style attempt.
  const scraped = await scrapeWatchPage(videoId);
  if (isUsablePlayer(scraped)) return scraped;
  if (!("error" in scraped) && !captionlessHit) captionlessHit = scraped;
  if ("error" in scraped) lastError = scraped;

  if (captionlessHit) return captionlessHit;
  return lastError ?? { error: "fetch_failed", message: "All Innertube clients exhausted." };
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

function pickTrack(captionTracks: InnertubeTrack[], lang?: string): InnertubeTrack {
  return lang
    ? (captionTracks.find((t) => t.languageCode === lang) ?? captionTracks[0]!)
    : captionTracks[0]!;
}

function buildTextUrl(track: InnertubeTrack, translateTo?: string): string {
  const tlang = translateTo && translateTo !== track.languageCode ? `&tlang=${translateTo}` : "";
  return track.baseUrl + "&fmt=json3" + tlang;
}

// Strip the `&exp=xpe` flag YouTube started attaching to some
// engagement-panel baseUrls in 2025-06 — those URLs return HTTP 200
// with a 0-byte body (the PoTokenRequired signal) until the flag is
// removed.
function stripPoTokenExp(url: string): string {
  return url.replace(/([?&])exp=xpe(&|$)/g, (_, before, after) => (after ? before : ""));
}

// Core retry/fallback logic shared by fetchTrackSegments and
// fetchSegmentsWithPoTokenRetry. Tries the primary baseUrl first, then
// strips `exp=xpe` and retries if the first attempt returns no segments.
async function fetchWithPoTokenRetryCore(
  baseUrl: string,
  languageCode: string,
  userAgent: string,
  translateTo?: string,
): Promise<Segment[] | ApiError> {
  const primary = buildTextUrl({ baseUrl, languageCode }, translateTo);
  let events = await fetchTimedText(primary, userAgent);
  if (Array.isArray(events)) {
    const segs = parseSegments(events);
    if (segs.length > 0) return segs;
  }

  const cleaned = stripPoTokenExp(baseUrl);
  if (cleaned !== baseUrl) {
    const retry = buildTextUrl({ baseUrl: cleaned, languageCode }, translateTo);
    events = await fetchTimedText(retry, userAgent);
    if (Array.isArray(events)) {
      const segs = parseSegments(events);
      if (segs.length > 0) return segs;
    }
  }

  return "error" in events ? events : { error: "fetch_failed", message: "Empty timedtext response" };
}

// Fetch + parse a captionTrack baseUrl into Segment[]. Used by the
// intercept correlator when YouTube's own page hasn't fetched
// /youtubei/v1/get_transcript (i.e. the user hasn't opened the
// transcript panel) but we already have a player capture.
export async function fetchTrackSegments(
  baseUrl: string,
  languageCode: string,
  translateTo?: string,
): Promise<Segment[] | ApiError> {
  return fetchWithPoTokenRetryCore(baseUrl, languageCode, WEB_UA, translateTo);
}

async function fetchTimedText(textUrl: string, userAgent: string): Promise<unknown[] | ApiError> {
  try {
    const res = await fetch(textUrl, {
      headers: { "User-Agent": userAgent },
      signal: timeoutSignal(TIMEDTEXT_TIMEOUT_MS),
    });
    if (!res.ok) return { error: "fetch_failed", message: `YouTube returned HTTP ${res.status} when fetching the transcript.` };
    const body = await res.text();
    if (!body.trim()) return { error: "fetch_failed", message: "YouTube returned an empty response. Open the video in a tab so we can capture it directly." };
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { error: "fetch_failed", message: "YouTube returned an unexpected response format. The track URL may have expired — try again." };
    }
    return digArr(parsed as Record<string, unknown>, "events");
  } catch (e) {
    if (isTimeoutError(e)) {
      return { error: "fetch_failed", message: `Transcript fetch timed out after ${TIMEDTEXT_TIMEOUT_MS}ms. YouTube may be throttling — try again.` };
    }
    return { error: "fetch_failed", message: e instanceof Error ? e.message : String(e) };
  }
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
    return { error: "no_captions", message: "This video has no transcript. Captions weren't created for it." };

  const track = pickTrack(captionTracks, lang);
  const segments = await fetchSegmentsWithPoTokenRetry(track, player.userAgent, translateTo);
  if ("error" in segments) return segments;

  if (segments.length === 0)
    return { error: "fetch_failed", message: "YouTube returned a transcript with no readable segments." };

  const language = track.languageCode;
  const chapters: Chapter[] = parseChapters(shortDescription);
  return {
    videoId,
    title,
    language: translateTo ?? language,
    isAutoGenerated: track.kind === "asr",
    tracks: mapTracks(captionTracks),
    segments,
    ...(chapters.length > 0 && { chapters }),
    ...(translateTo && translateTo !== language && { translatedFrom: language, translatedTo: translateTo }),
  };
}

/**
 * Try the captionTrack baseUrl as-is, and if YouTube returns the 0-byte
 * "PO token required" signal, strip `&exp=xpe` from the signed sparams
 * and retry. Without this, paste-URL requests for the (rare) video where
 * ANDROID_VR's baseUrl still carries `exp=xpe` would surface as "empty
 * timedtext response" even though the realtime intercept path could load
 * them.
 */
async function fetchSegmentsWithPoTokenRetry(
  track: InnertubeTrack,
  userAgent: string,
  translateTo?: string,
): Promise<Segment[] | ApiError> {
  return fetchWithPoTokenRetryCore(track.baseUrl, track.languageCode, userAgent, translateTo);
}

export async function fetchTracks(
  videoId: string,
): Promise<{ tracks: Track[]; title: string } | ApiError> {
  const player = await resolvePlayer(videoId);
  if ("error" in player) return player;

  const { title, captionTracks } = player;
  if (captionTracks.length === 0)
    return { error: "no_captions", message: "This video has no transcript. Captions weren't created for it." };

  return { tracks: mapTracks(captionTracks), title };
}
