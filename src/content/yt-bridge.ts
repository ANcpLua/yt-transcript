// ISOLATED-world content script — sibling of yt-interceptor.ts (which
// runs in MAIN). MAIN cannot touch chrome.* APIs, so it dispatches
// CustomEvents that this bridge listens for and forwards to the
// service worker. In Phase 0 we only console.debug captures (under a
// runtime flag) so we can verify interception works without changing
// any user-visible behaviour. Phase 1 will start forwarding via
// chrome.runtime.sendMessage.

export {};

const DEBUG_INTERCEPT = true; // Phase 0 verification flag — flips off in Phase 1.

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

function captureKind(url: string): "get_transcript" | "player" | "timedtext" | "other" {
  if (url.includes("/youtubei/v1/get_transcript")) return "get_transcript";
  if (url.includes("/youtubei/v1/player")) return "player";
  if (url.includes("/api/timedtext")) return "timedtext";
  return "other";
}

document.addEventListener("yt-tx-capture", (e) => {
  const ev = e as CustomEvent<string>;
  const payload = safeParse<CapturePayload>(ev.detail);
  if (!payload) return;

  const kind = captureKind(payload.url);
  if (kind === "other") return;

  if (DEBUG_INTERCEPT) {
    // Probe-only logging — drops bodyText length, never the body itself.
    // eslint-disable-next-line no-console
    console.debug(
      `[yt-tx] ${kind} status=${payload.status} bodyLen=${payload.bodyText.length} reqLen=${payload.requestBody.length}`,
    );
  }

  // Phase 1 will forward to SW here:
  // chrome.runtime.sendMessage({ type: "intercepted-capture", kind, payload })
});

document.addEventListener("yt-tx-navigate", (e) => {
  const ev = e as CustomEvent<string>;
  const payload = safeParse<NavigatePayload>(ev.detail);
  if (!payload) return;

  if (DEBUG_INTERCEPT) {
    // eslint-disable-next-line no-console
    console.debug(`[yt-tx] navigate ${payload.url}`);
  }
});
