"use strict";
(() => {
  // src/content/content.ts
  var VIDEO_ID_RE = /[?&]v=([a-zA-Z0-9_-]{11})/;
  var SHORTS_RE = /\/shorts\/([a-zA-Z0-9_-]{11})/;
  var EMBED_RE = /\/embed\/([a-zA-Z0-9_-]{11})/;
  var LIVE_RE = /\/live\/([a-zA-Z0-9_-]{11})/;
  var lastVideoId = null;
  var playerTimeInterval = null;
  var cachedPlayerResponse = null;
  function extractVideoId(url) {
    for (const re of [VIDEO_ID_RE, SHORTS_RE, EMBED_RE, LIVE_RE]) {
      const match = re.exec(url);
      if (match?.[1]) return match[1];
    }
    return null;
  }
  function extractPlayerResponseFromDOM() {
    for (const script of document.querySelectorAll("script")) {
      const text = script.textContent;
      if (!text?.includes("ytInitialPlayerResponse")) continue;
      const match = /var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|const|let|<\/script>)/s.exec(text);
      if (!match?.[1]) continue;
      try {
        return JSON.parse(match[1]);
      } catch {
      }
    }
    return null;
  }
  function detectAndNotify() {
    const videoId = extractVideoId(window.location.href);
    if (!videoId || videoId === lastVideoId) return;
    lastVideoId = videoId;
    const playerResponse = extractPlayerResponseFromDOM();
    if (playerResponse) {
      cachedPlayerResponse = { videoId, data: playerResponse };
    }
    chrome.runtime.sendMessage({ type: "video-detected", videoId });
    if (playerTimeInterval) clearInterval(playerTimeInterval);
    playerTimeInterval = setInterval(() => {
      const video = document.querySelector("video");
      if (video && !video.paused) {
        chrome.runtime.sendMessage({
          type: "player-time",
          currentTime: video.currentTime
        }).catch(() => {
        });
      }
    }, 1e3);
  }
  detectAndNotify();
  document.addEventListener("yt-navigate-finish", () => {
    lastVideoId = null;
    detectAndNotify();
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case "seek-to": {
        const video = document.querySelector("video");
        if (video) video.currentTime = message.time;
        return false;
      }
      case "request-player-data": {
        const videoId = message.videoId;
        if (cachedPlayerResponse?.videoId === videoId) {
          sendResponse({ type: "player-data-response", videoId, playerResponse: cachedPlayerResponse.data });
          return false;
        }
        const fresh = extractPlayerResponseFromDOM();
        if (fresh) {
          cachedPlayerResponse = { videoId, data: fresh };
          sendResponse({ type: "player-data-response", videoId, playerResponse: fresh });
          return false;
        }
        sendResponse({ type: "player-data-response", videoId, playerResponse: null });
        return false;
      }
    }
  });
})();
