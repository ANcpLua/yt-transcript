const VIDEO_ID_RE = /[?&]v=([a-zA-Z0-9_-]{11})/;
const SHORTS_RE = /\/shorts\/([a-zA-Z0-9_-]{11})/;
const EMBED_RE = /\/embed\/([a-zA-Z0-9_-]{11})/;
const LIVE_RE = /\/live\/([a-zA-Z0-9_-]{11})/;

let lastVideoId: string | null = null;
let playerTimeInterval: ReturnType<typeof setInterval> | null = null;
let cachedPlayerResponse: { videoId: string; data: unknown } | null = null;

function extractVideoId(url: string): string | null {
  for (const re of [VIDEO_ID_RE, SHORTS_RE, EMBED_RE, LIVE_RE]) {
    const match = re.exec(url);
    if (match?.[1]) return match[1];
  }
  return null;
}

// Extract ytInitialPlayerResponse from the page's script tags.
// Content scripts can't access page JS globals directly (isolated world),
// so we parse the raw script text from the DOM instead.
function extractPlayerResponseFromDOM(): unknown | null {
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent;
    if (!text?.includes("ytInitialPlayerResponse")) continue;

    const match = /var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|const|let|<\/script>)/s.exec(text);
    if (!match?.[1]) continue;

    try {
      return JSON.parse(match[1]);
    } catch {
      // JSON parse failed, try next script tag
    }
  }
  return null;
}

function detectAndNotify(): void {
  const videoId = extractVideoId(window.location.href);
  if (!videoId || videoId === lastVideoId) return;

  lastVideoId = videoId;

  // Extract player response on navigation (best time — data is fresh in the DOM)
  const playerResponse = extractPlayerResponseFromDOM();
  if (playerResponse) {
    cachedPlayerResponse = { videoId, data: playerResponse };
  }

  chrome.runtime.sendMessage({ type: "video-detected", videoId });

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

// YouTube SPA navigation
document.addEventListener("yt-navigate-finish", () => {
  lastVideoId = null; // Reset so detectAndNotify re-extracts for the new page
  detectAndNotify();
});

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

      // If cached response matches the requested video, return it
      if (cachedPlayerResponse?.videoId === videoId) {
        sendResponse({ type: "player-data-response", videoId, playerResponse: cachedPlayerResponse.data });
        return false;
      }

      // Try extracting fresh from DOM (user might still be on the page)
      const fresh = extractPlayerResponseFromDOM();
      if (fresh) {
        cachedPlayerResponse = { videoId, data: fresh };
        sendResponse({ type: "player-data-response", videoId, playerResponse: fresh });
        return false;
      }

      // No data available from content script
      sendResponse({ type: "player-data-response", videoId, playerResponse: null });
      return false;
    }
  }
});
