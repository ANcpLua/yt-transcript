// YouTube ISOLATED-world content script (document_idle).
//
// Stripped down post-rewrite: page-DOM extraction of ytInitialPlayerResponse
// and the request-player-data RPC are gone — the MAIN-world interceptor
// in yt-interceptor.ts captures everything we used to extract here, and
// then some. This file is now responsible only for:
//
//   - Telling the SW which videoId is on screen (for badging + side-panel).
//   - Relaying the <video> currentTime to the side panel for highlight sync.
//   - Honouring seek-to commands from the side panel.

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

function detectAndNotify(): void {
  const videoId = extractVideoId(window.location.href);
  if (!videoId || videoId === lastVideoId) return;
  lastVideoId = videoId;

  safeSendMessage({ type: "video-detected", videoId, platform: "youtube" });

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
