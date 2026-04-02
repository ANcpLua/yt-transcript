import { fetchTranscript, fetchTracks } from "./innertube";
import { fetchPlaylist, fetchChannel } from "./innertube-browse";
import type { AiRequestMessage, ExtensionMessage } from "../types/messages";

// Ask the content script on the active YouTube tab for page-extracted player data.
// Returns the raw player response if available, or null.
async function requestPagePlayerData(videoId: string): Promise<unknown | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes("youtube.com")) return null;

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "request-player-data",
      videoId,
    });
    return response?.playerResponse ?? null;
  } catch {
    // Content script not available (tab not on YouTube, extension just installed, etc.)
    return null;
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    switch (message.type) {
      case "video-detected":
        if (sender.tab?.id) {
          chrome.action.setBadgeText({ text: "1", tabId: sender.tab.id });
          chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId: sender.tab.id });
        }
        chrome.runtime.sendMessage({ type: "video-info", videoId: message.videoId }).catch(() => {});
        return false;

      case "player-time":
        chrome.runtime.sendMessage(message).catch(() => {});
        return false;

      case "fetch-transcript":
        requestPagePlayerData(message.videoId).then((pageData) =>
          fetchTranscript(message.videoId, message.lang, message.translateTo, pageData ?? undefined),
        ).then((result) => {
          if ("error" in result) {
            sendResponse({ type: "transcript-error", error: result });
          } else {
            sendResponse({ type: "transcript-result", data: result });
          }
        });
        return true;

      case "fetch-tracks":
        requestPagePlayerData(message.videoId).then((pageData) =>
          fetchTracks(message.videoId, pageData ?? undefined),
        ).then((result) => {
          if ("error" in result) {
            sendResponse({ type: "tracks-error", error: result });
          } else {
            sendResponse({ type: "tracks-result", ...result });
          }
        });
        return true;

      case "fetch-playlist":
        fetchPlaylist(message.playlistId).then((result) => sendResponse(result));
        return true;

      case "fetch-channel":
        fetchChannel(message.identifier).then((result) => sendResponse(result));
        return true;

      case "ai-request":
        handleAiRequest(message)
          .then((content) => sendResponse({ type: "ai-result", content }))
          .catch((err: unknown) => sendResponse({ type: "ai-error", error: String(err) }));
        return true;
    }
  },
);

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Backup: detect YouTube navigation via webNavigation API
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    const url = new URL(details.url);
    const videoId = url.searchParams.get("v");
    if (videoId) {
      chrome.action.setBadgeText({ text: "1", tabId: details.tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId: details.tabId });
      chrome.runtime.sendMessage({ type: "video-info", videoId }).catch(() => {});
    }
  },
  { url: [{ hostSuffix: "youtube.com" }] },
);

async function handleAiRequest(message: AiRequestMessage): Promise<string> {
  if (!message.apiKey) throw new Error("No API key configured");

  const { getProvider } = await import("../lib/ai/providers");
  const provider = getProvider(message.provider, message.apiKey);

  return provider.sendMessage({
    systemPrompt: message.systemPrompt,
    userMessage: message.userMessage,
  });
}
