// ISOLATED-world content script — sibling of yt-interceptor.ts (MAIN).
// Receives CustomEvents from the page-context interceptor, parses
// the videoId out of the request body, and forwards to the service
// worker. MAIN-world has no chrome.* APIs so this is the only path.

import { extractVideoIdFromRequest } from "@/lib/intercept/parseGetTranscript";
import type { InterceptKind } from "@/types/messages";

export {};

interface CapturePayload {
  url: string;
  status: number;
  bodyText: string;
  requestBody: string;
  ts: number;
}

interface NavigatePayload {
  url: string;
  ts: number;
}

function safeParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function captureKind(url: string): InterceptKind | "other" {
  if (url.includes("/youtubei/v1/get_transcript")) return "get_transcript";
  if (url.includes("/youtubei/v1/player")) return "player";
  if (url.includes("/api/timedtext")) return "timedtext";
  return "other";
}

function videoIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const v = u.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  } catch {
    // pass
  }
  return null;
}

function isExtensionAlive(): boolean {
  return Boolean(chrome.runtime?.id);
}

function safeSend(message: unknown): void {
  if (!isExtensionAlive()) return;
  try {
    const r = chrome.runtime.sendMessage(message);
    if (r && typeof (r as Promise<unknown>).catch === "function") {
      (r as Promise<unknown>).catch(() => {});
    }
  } catch {
    // Orphaned content script after extension reload — ignore.
  }
}

document.addEventListener("yt-tx-capture", (e) => {
  const ev = e as CustomEvent<string>;
  const payload = safeParse<CapturePayload>(ev.detail);
  if (!payload) return;

  const kind = captureKind(payload.url);
  if (kind === "other") return;

  // Prefer parsing videoId from the request body (works for player + get_transcript);
  // fall back to URL `?v=` for /api/timedtext.
  const videoId =
    extractVideoIdFromRequest(payload.requestBody) ?? videoIdFromUrl(payload.url);

  safeSend({
    type: "intercepted-capture",
    kind,
    videoId,
    url: payload.url,
    status: payload.status,
    bodyText: payload.bodyText,
  });
});

document.addEventListener("yt-tx-navigate", (e) => {
  const ev = e as CustomEvent<string>;
  const payload = safeParse<NavigatePayload>(ev.detail);
  if (!payload) return;
  const videoId = videoIdFromUrl(payload.url);
  safeSend({ type: "intercepted-navigate", url: payload.url, videoId });
});
