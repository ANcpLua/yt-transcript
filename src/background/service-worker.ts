import { fetchPlaylist, fetchChannel } from "./innertube-browse";
import { fetchTrackSegments } from "./innertube";
import { YouTubeProvider } from "./providers/youtube";
import { VimeoProvider } from "./providers/vimeo";
import { isApiError } from "./providers/types";
import type { TranscriptProvider } from "./providers/types";
import type { AiRequestMessage, ExtensionMessage } from "../types/messages";
import type { Platform } from "../types/transcript";
import {
  claimAutoFetchTrack,
  clearTab,
  getBroadcastingTabId,
  notifyNavigate,
  recordAutoFetchedSegments,
  recordBroadcast,
  recordPlayer,
  recordTimedText,
  recordTranscript,
  releaseAutoFetch,
  takeIfReady,
} from "../lib/intercept/correlator";

const providers: Record<Platform, TranscriptProvider> = {
  youtube: new YouTubeProvider(),
  vimeo: new VimeoProvider(),
};

// Vimeo's ISOLATED-world content script still extracts player config from
// the DOM (Vimeo's auth is simpler — no PO tokens, no SAPISIDHASH). YouTube
// no longer goes through this path; the MAIN-world interceptor + correlator
// is the live capture and Innertube WEB_EMBEDDED_PLAYER is the paste-URL
// fallback.
async function requestVimeoPlayerData(videoId: string): Promise<unknown | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !tab.url.includes("vimeo.com")) return null;
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "request-player-data",
      videoId,
    });
    return response?.playerResponse ?? null;
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    switch (message.type) {
      case "video-detected":
        if (sender.tab?.id) {
          setBadge(sender.tab.id);
        }
        chrome.runtime.sendMessage({
          type: "video-info",
          videoId: message.videoId,
          platform: message.platform,
        }).catch(() => {});
        return false;

      case "player-time":
        chrome.runtime.sendMessage(message).catch(() => {});
        return false;

      case "seek-to": {
        // chrome.runtime.sendMessage from the side panel doesn't reach
        // content scripts; we must forward via chrome.tabs.sendMessage to
        // the tab that produced the currently-displayed transcript.
        const tabId = getBroadcastingTabId();
        if (tabId !== null) {
          chrome.tabs.sendMessage(tabId, message).catch(() => {});
        }
        return false;
      }

      case "fetch-transcript": {
        const provider = providers[message.platform];
        const pageDataPromise =
          message.platform === "vimeo"
            ? requestVimeoPlayerData(message.videoId)
            : Promise.resolve(null);
        pageDataPromise
          .then((pageData) =>
            provider.fetchTranscript(message.videoId, {
              lang: message.lang,
              translateTo: message.translateTo,
              pageData: pageData ?? undefined,
            }),
          )
          .then((result) => {
            if (isApiError(result)) {
              sendResponse({ type: "transcript-error", error: result });
            } else {
              sendResponse({ type: "transcript-result", data: result });
            }
          });
        return true;
      }

      case "fetch-tracks": {
        const provider = providers[message.platform];
        const pageDataPromise =
          message.platform === "vimeo"
            ? requestVimeoPlayerData(message.videoId)
            : Promise.resolve(null);
        pageDataPromise
          .then((pageData) => provider.fetchTracks(message.videoId, pageData ?? undefined))
          .then((result) => {
            if (isApiError(result)) {
              sendResponse({ type: "tracks-error", error: result });
            } else {
              sendResponse({ type: "tracks-result", ...result });
            }
          });
        return true;
      }

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

      case "start-transcription":
        handleStartTranscription(message.videoId, message.title)
          .catch((err: unknown) => {
            chrome.runtime.sendMessage({
              type: "transcription-error",
              error: String(err),
            }).catch(() => {});
          });
        return false;

      case "stop-transcription":
        handleStopTranscription();
        return false;

      case "check-whisper-status":
        handleCheckWhisperStatus(message.model).then((status) => sendResponse(status));
        return true;

      case "download-whisper":
        handleDownloadWhisper(message.model);
        return false;

      case "delete-whisper":
        handleDeleteWhisper().then(() => sendResponse({ success: true }));
        return true;

      case "intercepted-capture": {
        const tabId = sender.tab?.id;
        if (!tabId || !message.videoId) return false;
        console.log(`[intercept] kind=${message.kind} videoId=${message.videoId} bodyLen=${message.bodyText?.length ?? 0}`);
        if (message.kind === "player") {
          recordPlayer(tabId, message.videoId, message.bodyText);
        } else if (message.kind === "get_transcript") {
          recordTranscript(tabId, message.videoId, message.bodyText);
        } else if (message.kind === "timedtext") {
          recordTimedText(tabId, message.videoId, message.bodyText);
        }
        const ready = takeIfReady(tabId);
        if (ready) {
          console.log(`[intercept] emitting intercepted-transcript videoId=${ready.videoId} segments=${ready.segments.length}`);
          recordBroadcast(tabId);
          chrome.runtime
            .sendMessage({ type: "intercepted-transcript", data: ready })
            .catch(() => {});
        } else if (message.kind === "player") {
          // YouTube doesn't fetch /youtubei/v1/get_transcript until the user
          // opens its transcript panel, so wait-for-segments would stall on
          // a fresh page load. Auto-fetch the captionTrack baseUrl from the
          // captured player to close that gap.
          console.log(`[intercept] auto-fetch requested for ${message.videoId}`);
          maybeAutoFetchTimedText(tabId, message.videoId);
        }
        return false;
      }

      case "intercepted-navigate": {
        const tabId = sender.tab?.id;
        if (!tabId) return false;
        notifyNavigate(tabId, message.videoId);
        return false;
      }
    }
  },
);

function maybeAutoFetchTimedText(tabId: number, videoId: string): void {
  const track = claimAutoFetchTrack(tabId, videoId);
  if (!track) {
    console.log(`[auto-fetch] skip (no track or already claimed) ${videoId}`);
    return;
  }
  console.log(`[auto-fetch] claim ${videoId} ${track.languageCode} ${track.baseUrl.slice(0, 80)}`);
  void fetchTrackSegments(track.baseUrl, track.languageCode)
    .then((result) => {
      if (isApiError(result)) {
        console.log(`[auto-fetch] failed: ${result.error} ${result.message}`);
        releaseAutoFetch(tabId);
        return;
      }
      console.log(`[auto-fetch] ok: ${result.length} segments`);
      recordAutoFetchedSegments(tabId, videoId, result);
      const ready = takeIfReady(tabId);
      if (ready) {
        recordBroadcast(tabId);
        chrome.runtime
          .sendMessage({ type: "intercepted-transcript", data: ready })
          .catch(() => {});
      }
    })
    .catch((err) => {
      console.log(`[auto-fetch] error: ${err}`);
      releaseAutoFetch(tabId);
    });
}

// Drop correlator state when a tab closes so we don't leak captured
// JSON across the SW lifetime.
chrome.tabs.onRemoved.addListener((tabId) => {
  clearTab(tabId);
});

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

function setBadge(tabId: number): void {
  if (!chrome.action) return;
  chrome.action.setBadgeText({ text: "1", tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId }).catch(() => {});
}

// Detect navigation on YouTube
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    const url = new URL(details.url);
    const videoId = url.searchParams.get("v");
    if (videoId) {
      setBadge(details.tabId);
      chrome.runtime.sendMessage({ type: "video-info", videoId, platform: "youtube" as Platform }).catch(() => {});
    }
  },
  { url: [{ hostSuffix: "youtube.com" }] },
);

// Detect navigation on Vimeo
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    const match = /\/(\d+)(?:\?|$|#)/.exec(details.url);
    if (match?.[1]) {
      const videoId = match[1];
      setBadge(details.tabId);
      chrome.runtime.sendMessage({ type: "video-info", videoId, platform: "vimeo" as Platform }).catch(() => {});
    }
  },
  { url: [{ hostSuffix: "vimeo.com" }] },
);

async function handleAiRequest(message: AiRequestMessage): Promise<string> {
  const { getProvider, DEFAULT_OLLAMA_URL, DEFAULT_OLLAMA_MODEL } = await import("../lib/ai/providers");

  let provider;
  if (message.provider === "ollama") {
    provider = getProvider("ollama", {
      url: message.ollamaUrl || DEFAULT_OLLAMA_URL,
      model: message.ollamaModel || DEFAULT_OLLAMA_MODEL,
    });
  } else {
    if (!message.apiKey) throw new Error("No API key configured");
    provider = getProvider(message.provider, message.apiKey);
  }

  return provider.sendMessage({
    systemPrompt: message.systemPrompt,
    userMessage: message.userMessage,
  });
}

// ---------- Whisper transcription ----------

let offscreenCreated = false;

async function ensureOffscreen(): Promise<void> {
  if (offscreenCreated) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen/offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Capture tab audio for local Whisper transcription",
    });
    offscreenCreated = true;
  } catch {
    // Already exists
    offscreenCreated = true;
  }
}

async function handleStartTranscription(videoId: string, title: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await ensureOffscreen();

  chrome.runtime.sendMessage({
    type: "offscreen-start-capture",
    streamId,
    videoId,
    title,
  }).catch(() => {});
}

function handleStopTranscription(): void {
  chrome.runtime.sendMessage({ type: "offscreen-stop-capture" }).catch(() => {});
}

const WHISPER_STATUS_TIMEOUT_MS = 10_000;

async function handleCheckWhisperStatus(
  model: "tiny" | "base" = "tiny",
): Promise<{ type: string; downloaded: boolean; modelId: string; model: "tiny" | "base" }> {
  // Check is delegated to offscreen document which has CacheStorage access.
  // Carry the model through so the caller can verify the response is scoped
  // to the same model they asked about (avoids a stale "ready" if the user
  // flipped the selector between request and response).
  //
  // Race the listener against a 10s timeout so a crashed/silent offscreen
  // document doesn't leave the side panel spinning forever — fall back
  // to `downloaded: false`, which makes the UI show the download button
  // (worst case the user re-clicks).
  await ensureOffscreen();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (downloaded: boolean, modelId?: string): void => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(timer);
      resolve({
        type: "whisper-status",
        downloaded,
        modelId: modelId ?? `whisper-${model}`,
        model,
      });
    };
    const listener = (msg: { type: string; downloaded?: boolean; modelId?: string; model?: "tiny" | "base" }) => {
      if (msg.type !== "whisper-status-response") return;
      if (msg.model !== model) return;
      finish(msg.downloaded ?? false, msg.modelId);
    };
    const timer = setTimeout(() => finish(false), WHISPER_STATUS_TIMEOUT_MS);
    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage({ type: "offscreen-check-whisper", model }).catch(() => finish(false));
  });
}

function handleDownloadWhisper(model: "tiny" | "base"): void {
  void ensureOffscreen().then(() => {
    chrome.runtime.sendMessage({ type: "offscreen-download-whisper", model }).catch(() => {});
  });
}

async function handleDeleteWhisper(): Promise<void> {
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: "offscreen-delete-whisper" }).catch(() => {});
}
