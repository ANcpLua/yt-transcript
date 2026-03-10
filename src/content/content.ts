// src/content/content.ts

const VIDEO_ID_RE = /[?&]v=([a-zA-Z0-9_-]{11})/;
const SHORTS_RE = /\/shorts\/([a-zA-Z0-9_-]{11})/;
const EMBED_RE = /\/embed\/([a-zA-Z0-9_-]{11})/;
const LIVE_RE = /\/live\/([a-zA-Z0-9_-]{11})/;

let lastVideoId: string | null = null;
let playerTimeInterval: ReturnType<typeof setInterval> | null = null;

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
document.addEventListener("yt-navigate-finish", () => detectAndNotify());

// Handle seek-to messages from side panel
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "seek-to") {
    const video = document.querySelector("video");
    if (video) video.currentTime = message.time;
  }
});
