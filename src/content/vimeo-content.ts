export {};

const VIMEO_ID_RE = /\/(\d+)(?:\?|$|#)/;

let lastVideoId: string | null = null;
let playerTimeInterval: ReturnType<typeof setInterval> | null = null;
let cachedPlayerConfig: { videoId: string; data: unknown } | null = null;

function extractVideoId(url: string): string | null {
  const match = VIMEO_ID_RE.exec(url);
  return match?.[1] ?? null;
}

// Extract Vimeo player config from page scripts.
// Vimeo embeds config as JSON in script tags or in window.__player_config / vimeo.clip_page_config.
function extractPlayerConfigFromDOM(): unknown | null {
  // Approach 1: Look for a script containing the player config JSON
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent;
    if (!text) continue;

    // Vimeo often embeds: window.playerConfig = {...} or similar
    for (const pattern of [
      /window\.playerConfig\s*=\s*(\{.+?\});/s,
      /var\s+config\s*=\s*(\{.+?"video".+?\});/s,
    ]) {
      const match = pattern.exec(text);
      if (!match?.[1]) continue;
      try {
        const parsed = JSON.parse(match[1]) as Record<string, unknown>;
        if (parsed["video"] || parsed["request"]) return parsed;
      } catch { /* try next pattern */ }
    }
  }

  // Approach 2: Look for JSON-LD or preloaded data with text_tracks
  for (const script of document.querySelectorAll('script[type="application/json"]')) {
    const text = script.textContent;
    if (!text?.includes("text_tracks")) continue;
    try {
      return JSON.parse(text);
    } catch { /* skip */ }
  }

  return null;
}

function detectAndNotify(): void {
  const videoId = extractVideoId(window.location.href);
  if (!videoId || videoId === lastVideoId) return;

  lastVideoId = videoId;

  const playerConfig = extractPlayerConfigFromDOM();
  if (playerConfig) {
    cachedPlayerConfig = { videoId, data: playerConfig };
  }

  chrome.runtime.sendMessage({ type: "video-detected", videoId, platform: "vimeo" });

  // Start player time relay (1Hz)
  if (playerTimeInterval) clearInterval(playerTimeInterval);
  playerTimeInterval = setInterval(() => {
    const video = document.querySelector("video");
    if (video && !video.paused) {
      chrome.runtime.sendMessage({
        type: "player-time",
        currentTime: video.currentTime,
      }).catch(() => {});
    }
  }, 1000);
}

// Initial detection
detectAndNotify();

// Vimeo uses standard History API for SPA navigation
window.addEventListener("popstate", () => {
  lastVideoId = null;
  detectAndNotify();
});

// Also watch for URL changes via pushState (Vimeo's SPA)
const origPushState = history.pushState.bind(history);
history.pushState = function (...args: Parameters<typeof origPushState>) {
  origPushState(...args);
  lastVideoId = null;
  setTimeout(detectAndNotify, 100);
};

// Handle messages from service worker / side panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "seek-to": {
      const video = document.querySelector("video");
      if (video) video.currentTime = message.time;
      return false;
    }

    case "request-player-data": {
      const videoId = message.videoId as string;

      if (cachedPlayerConfig?.videoId === videoId) {
        sendResponse({ type: "player-data-response", videoId, playerResponse: cachedPlayerConfig.data });
        return false;
      }

      const fresh = extractPlayerConfigFromDOM();
      if (fresh) {
        cachedPlayerConfig = { videoId, data: fresh };
        sendResponse({ type: "player-data-response", videoId, playerResponse: fresh });
        return false;
      }

      sendResponse({ type: "player-data-response", videoId, playerResponse: null });
      return false;
    }
  }
});
