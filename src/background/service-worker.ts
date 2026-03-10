import { fetchTranscript, fetchTracks } from "./innertube";
import { fetchPlaylist, fetchChannel } from "./innertube-browse";
import type { AiRequestMessage, ExtensionMessage } from "../types/messages";
import type { AiFeature } from "../types/transcript";

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
        fetchTranscript(message.videoId, message.lang, message.translateTo).then((result) => {
          if ("error" in result) {
            sendResponse({ type: "transcript-error", error: result });
          } else {
            sendResponse({ type: "transcript-result", data: result });
          }
        });
        return true; // keep channel open for async

      case "fetch-tracks":
        fetchTracks(message.videoId).then((result) => {
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
  if (message.provider === "chrome-ai") {
    const { chromeAiSummarize } = await import("../lib/ai/chrome-ai");
    return chromeAiSummarize(message.text);
  }

  // BYOK providers — validate key presence
  if (!message.config?.apiKey) throw new Error("No API key configured");

  const { getProvider } = await import("../lib/ai/providers");
  const provider = getProvider(message.provider, message.config.apiKey);

  // Build prompt from feature using promptTemplates
  const { promptTemplates } = await import("../lib/ai/prompts");

  const AI_FEATURES = new Set<string>([
    "summary",
    "bulletPoints",
    "chapterSummary",
    "actionItems",
    "quotes",
    "blogOutline",
    "socialPosts",
    "studyNotes",
    "flashcards",
    "seoKeywords",
    "entities",
  ]);

  if (!AI_FEATURES.has(message.feature)) {
    throw new Error(`Unknown AI feature: ${message.feature}`);
  }

  const feature = message.feature as AiFeature;
  const template = promptTemplates[feature];

  return provider.sendMessage({
    systemPrompt: template.system,
    userMessage: template.user(message.text),
  });
}
