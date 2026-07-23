import { fetchPlaylist, fetchChannel } from "./innertube-browse";
import { YouTubeProvider } from "./providers/youtube";
import { isApiError } from "./providers/types";
import type { TranscriptProvider } from "./providers/types";
import type { ExtensionMessage } from "../types/messages";
import {
  cancelPendingTranscription,
  finishTabTranscription,
  getTabTranscriptionState,
  handleActionClick,
  handleCapturedTabClosed,
  startActiveTabTranscription,
  startFileTranscription,
  stopTranscription,
} from "./transcribe/tab-capture";
import {
  cancelPendingDiscovery,
  clearDiscoveryTab,
  discoverCurrentTab,
  getDiscoveryState,
  handleDiscoveryAction,
  prepareUrlDiscovery,
  recordAdapterTranscript,
  rediscoverTab,
  recordMediaState,
  recordPageSnapshot,
  recordTimedTextResource,
  selectDiscoveredTrack,
} from "./discovery/coordinator";
import {
  clearTab,
  getBroadcastingTabId,
  recordBroadcast,
  recordPlayer,
  recordTimedText,
  takeIfReady,
} from "../lib/intercept/correlator";

const youtubeProvider: TranscriptProvider = new YouTubeProvider();

function sendPanelMessage(message: object): void {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

function sendTabMessage(tabId: number, message: object): void {
  chrome.tabs.sendMessage(tabId, message, () => {
    void chrome.runtime.lastError;
  });
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    switch (message.type) {
      case "player-time":
        sendPanelMessage(message);
        return false;

      case "timed-text-page-snapshot": {
        const tabId = sender.tab?.id;
        if (tabId === undefined) return false;
        recordPageSnapshot(tabId, sender.frameId ?? 0, message.snapshot);
        return false;
      }

      case "timed-text-resource": {
        const tabId = sender.tab?.id;
        if (tabId === undefined) return false;
        void recordTimedTextResource(tabId, sender.frameId ?? 0, message.resource);
        return false;
      }

      case "media-playback-state": {
        const tabId = sender.tab?.id;
        if (tabId === undefined) return false;
        recordMediaState(tabId, sender.frameId ?? 0, message.state);
        return false;
      }

      case "seek-to": {
        // chrome.runtime.sendMessage from the side panel doesn't reach
        // content scripts; we must forward via chrome.tabs.sendMessage to
        // the tab that produced the currently-displayed transcript.
        const tabId = getBroadcastingTabId();
        if (tabId !== null) {
          sendTabMessage(tabId, message);
        }
        return false;
      }

      case "fetch-transcript": {
        if (message.platform !== "youtube") {
          sendResponse({
            type: "transcript-error",
            error: {
              error: "invalid_request",
              message: "Single-page transcripts are discovered from the active media page.",
            },
          });
          return false;
        }
        youtubeProvider
          .fetchTranscript(message.videoId, {
            lang: message.lang,
            translateTo: message.translateTo,
          })
          .then((result) => {
            if (isApiError(result)) {
              sendResponse({ type: "transcript-error", error: result });
            } else {
              sendResponse({ type: "transcript-result", data: result });
            }
          });
        return true;
      }

      case "discover-current-tab":
        discoverCurrentTab().then(sendResponse);
        return true;

      case "rediscover-tab":
        rediscoverTab(message.tabId).then(sendResponse);
        return true;

      case "prepare-url-discovery":
        prepareUrlDiscovery(message.url).then(sendResponse);
        return true;

      case "get-discovery-state":
        getDiscoveryState().then(sendResponse);
        return true;

      case "cancel-pending-discovery":
        cancelPendingDiscovery(message.tabId)
          .then(() => sendResponse({ status: "idle" }))
          .catch((error: unknown) => {
            sendResponse({
              status: "error",
              error: error instanceof Error ? error.message : "Could not cancel page discovery.",
            });
          });
        return true;

      case "select-discovered-track": {
        selectDiscoveredTrack(message.videoId, message.trackId)
          .then((data) => {
            sendResponse(data
              ? { type: "transcript-result", data }
              : {
                  type: "transcript-error",
                  error: {
                    error: "fetch_failed",
                    message: "That text track is no longer available on the page.",
                  },
                });
          })
          .catch((error: unknown) => {
            sendResponse({
              type: "transcript-error",
              error: {
                error: "fetch_failed",
                message: error instanceof Error
                  ? error.message
                  : "That text track could not be restored.",
              },
            });
          });
        return true;
      }

      case "fetch-playlist":
        fetchPlaylist(message.playlistId).then((result) => sendResponse(result));
        return true;

      case "fetch-channel":
        fetchChannel(message.identifier).then((result) => sendResponse(result));
        return true;

      case "start-transcription":
        startActiveTabTranscription(message.videoId, message.title)
          .then(sendResponse)
          .catch((error: unknown) => {
            sendResponse({
              status: "error",
              error: error instanceof Error ? error.message : "Could not start tab transcription.",
            });
          });
        return true;

      case "get-tab-transcription-state":
        getTabTranscriptionState()
          .then(sendResponse)
          .catch((error: unknown) => {
            sendResponse({
              status: "error",
              error: error instanceof Error ? error.message : "Could not read transcription state.",
            });
          });
        return true;

      case "cancel-pending-transcription":
        cancelPendingTranscription(message.tabId)
          .then(() => sendResponse({ status: "idle" }))
          .catch((error: unknown) => {
            sendResponse({
              status: "error",
              error: error instanceof Error ? error.message : "Could not cancel this request.",
            });
          });
        return true;

      case "stop-transcription":
        void stopTranscription().catch((error: unknown) => {
          sendPanelMessage({
            type: "transcription-error",
            error: error instanceof Error ? error.message : "Could not stop transcription.",
          });
        });
        return false;

      case "transcribe-file":
        void startFileTranscription(message.blobUrl, message.videoId, message.title)
          .catch((error: unknown) => {
            sendPanelMessage({
              type: "transcription-error",
              videoId: message.videoId,
              error: error instanceof Error ? error.message : "Could not start file transcription.",
            });
          });
        return false;

      case "transcription-complete":
        void finishTabTranscription(message.videoId);
        return false;

      case "transcription-error":
        void finishTabTranscription(message.videoId);
        return false;

      case "intercepted-capture": {
        const tabId = sender.tab?.id;
        if (!tabId || !message.videoId) return false;
        if (message.kind === "player") {
          recordPlayer(tabId, message.videoId, message.bodyText);
        } else {
          recordTimedText(tabId, message.videoId, message.bodyText);
        }
        const ready = takeIfReady(tabId);
        if (ready) {
          ready.source = "platform-adapter";
          recordAdapterTranscript(tabId, ready);
          recordBroadcast(tabId);
          sendPanelMessage({ type: "intercepted-transcript", data: ready });
        }
        return false;
      }
    }
  },
);

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTab(tabId);
  void clearDiscoveryTab(tabId);
  void handleCapturedTabClosed(tabId).catch((error: unknown) => {
    sendPanelMessage({
      type: "transcription-error",
      error: error instanceof Error ? error.message : "Could not stop the closed tab capture.",
    });
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  void chrome.sidePanel.open({ tabId: tab.id }).catch((error: unknown) => {
    sendPanelMessage({
      type: "discovery-error",
      error: error instanceof Error ? error.message : "Could not open the side panel.",
    });
  });
  void handleActionClick(tab)
    .then((handledTranscription) => {
      if (!handledTranscription) return handleDiscoveryAction(tab);
      return true;
    })
    .catch((error: unknown) => {
      sendPanelMessage({
        type: "discovery-error",
        error: error instanceof Error ? error.message : "Could not inspect this media page.",
      });
    });
});
