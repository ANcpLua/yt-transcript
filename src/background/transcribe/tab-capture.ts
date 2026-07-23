import type {
  TabTranscriptionResponse,
  TabTranscriptionTarget,
  TranscriptionAwaitingActionMessage,
  TranscriptionErrorMessage,
  TranscriptionStartedMessage,
} from "../../types/messages";
import { currentMediaState } from "../discovery/coordinator";

const OFFSCREEN_PATH = "offscreen/offscreen.html";
const ACTIVE_CAPTURE_KEY = "active-tab-transcription";
const PENDING_CAPTURE_PREFIX = "pending-tab-transcription:";
const DEFAULT_ACTION_TITLE = "Video Transcript";

let offscreenCreation: Promise<void> | null = null;

function pendingCaptureKey(tabId: number): string {
  return `${PENDING_CAPTURE_PREFIX}${tabId}`;
}

async function readStored<T>(key: string): Promise<T | undefined> {
  const stored = await chrome.storage.session.get(key);
  return stored[key] as T | undefined;
}

async function getPendingCapture(tabId: number): Promise<TabTranscriptionTarget | undefined> {
  return readStored<TabTranscriptionTarget>(pendingCaptureKey(tabId));
}

async function getActiveCapture(): Promise<TabTranscriptionTarget | undefined> {
  return readStored<TabTranscriptionTarget>(ACTIVE_CAPTURE_KEY);
}

async function getRunningCapture(): Promise<TabTranscriptionTarget | undefined> {
  const active = await getActiveCapture();
  if (!active) return undefined;

  const capturedTabs = await chrome.tabCapture.getCapturedTabs();
  if (capturedTabs.some((capture) => capture.tabId === active.tabId)) return active;

  await chrome.storage.session.remove(ACTIVE_CAPTURE_KEY);
  await clearBadge(active.tabId);
  return undefined;
}

function broadcast(
  message:
    | TranscriptionAwaitingActionMessage
    | TranscriptionStartedMessage
    | TranscriptionErrorMessage,
): void {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

function isCapturableUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function titleForTab(tab: chrome.tabs.Tab, fallbackUrl: string): string {
  const title = tab.title?.trim();
  if (title) return title;
  if (fallbackUrl) {
    try {
      return new URL(fallbackUrl).hostname.replace(/^www\./, "") || "Current tab";
    } catch {
      return "Current tab";
    }
  }
  return "Current tab";
}

function createTarget(
  tab: chrome.tabs.Tab,
  sourceUrl: string,
  videoId?: string,
  title?: string,
): TabTranscriptionTarget {
  if (tab.id === undefined) throw new Error("Chrome did not provide a target tab.");
  return {
    tabId: tab.id,
    videoId: videoId ?? `tab-${tab.id}-${Date.now()}`,
    title: title?.trim() || titleForTab(tab, sourceUrl),
    url: sourceUrl,
  };
}

async function setPendingBadge(tabId: number): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: "GO" }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" }),
    chrome.action.setTitle({ tabId, title: "Click to start on-device transcription" }),
  ]);
}

async function clearBadge(tabId: number): Promise<void> {
  await Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: "" }),
    chrome.action.setTitle({ tabId, title: DEFAULT_ACTION_TITLE }),
  ]);
}

async function setRecordingBadge(tabId: number): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: "REC" }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#dc2626" }),
    chrome.action.setTitle({ tabId, title: "On-device transcription is running" }),
  ]);
}

async function armCapture(target: TabTranscriptionTarget): Promise<TabTranscriptionResponse> {
  await chrome.storage.session.set({ [pendingCaptureKey(target.tabId)]: target });
  await setPendingBadge(target.tabId);
  broadcast({ type: "transcription-awaiting-action", ...target });
  return { status: "awaiting-action", ...target };
}

async function clearPendingCapture(tabId: number): Promise<void> {
  await chrome.storage.session.remove(pendingCaptureKey(tabId));
  await clearBadge(tabId);
}

async function ensureOffscreen(): Promise<void> {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl],
  });
  if (contexts.length > 0) return;

  if (!offscreenCreation) {
    offscreenCreation = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Capture tab audio for on-device transcription",
    });
  }

  try {
    await offscreenCreation;
  } finally {
    offscreenCreation = null;
  }
}

function isPermissionGrantError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /activeTab|permission|not been invoked|not allowed to capture/i.test(message);
}

function errorResponse(error: unknown): TabTranscriptionResponse {
  return {
    status: "error",
    error: error instanceof Error ? error.message : "Could not start tab transcription.",
  };
}

async function startCapture(
  tab: chrome.tabs.Tab,
  requestedTarget: TabTranscriptionTarget,
): Promise<TabTranscriptionResponse> {
  if (tab.id === undefined || tab.id !== requestedTarget.tabId) {
    return { status: "error", error: "The requested video tab is no longer available." };
  }
  if (!isCapturableUrl(tab.url)) {
    return {
      status: "error",
      error: "This page cannot be captured. Open a regular http or https video page.",
    };
  }

  const existing = await getRunningCapture();
  if (existing) {
    if (existing.tabId === tab.id) return { status: "started", ...existing };
    return {
      status: "error",
      error: "Finish the current tab transcription before starting another one.",
    };
  }

  const target: TabTranscriptionTarget = {
    ...requestedTarget,
    title: titleForTab(tab, requestedTarget.url),
    url: tab.url,
  };

  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await chrome.storage.session.set({ [ACTIVE_CAPTURE_KEY]: target });
  await Promise.all([
    chrome.storage.session.remove(pendingCaptureKey(tab.id)),
    setRecordingBadge(tab.id),
  ]);
  broadcast({ type: "transcription-started", ...target });
  try {
    await chrome.runtime.sendMessage({
      type: "offscreen-start-capture",
      streamId,
      videoId: target.videoId,
      title: target.title,
    });
    const state = currentMediaState(target.tabId);
    if (state) {
      chrome.runtime.sendMessage({ type: "media-playback-state", state }, () => {
        void chrome.runtime.lastError;
      });
    }
  } catch (error) {
    await chrome.storage.session.remove(ACTIVE_CAPTURE_KEY);
    await clearBadge(tab.id);
    throw error;
  }
  return { status: "started", ...target };
}

async function startOrArmCapture(
  tab: chrome.tabs.Tab,
  target: TabTranscriptionTarget,
): Promise<TabTranscriptionResponse> {
  try {
    return await startCapture(tab, target);
  } catch (error) {
    if (isPermissionGrantError(error)) return armCapture(target);
    return errorResponse(error);
  }
}

export async function startActiveTabTranscription(
  videoId?: string,
  title?: string,
): Promise<TabTranscriptionResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    return {
      status: "error",
      error: "Open a regular video page in the active tab, then try again.",
    };
  }

  if (!tab.url) {
    return armCapture(createTarget(tab, "", videoId, title));
  }
  if (!isCapturableUrl(tab.url)) {
    return {
      status: "error",
      error: "This page cannot be captured. Open a regular http or https video page.",
    };
  }

  return startOrArmCapture(tab, createTarget(tab, tab.url, videoId, title));
}

export async function getTabTranscriptionState(): Promise<TabTranscriptionResponse> {
  const activeCapture = await getRunningCapture();
  if (activeCapture) return { status: "started", ...activeCapture };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { status: "idle" };
  const pendingCapture = await getPendingCapture(tab.id);
  return pendingCapture
    ? { status: "awaiting-action", ...pendingCapture }
    : { status: "idle" };
}

export async function cancelPendingTranscription(tabId: number): Promise<void> {
  const pending = await getPendingCapture(tabId);
  if (!pending) return;
  await clearPendingCapture(tabId);
}

export async function startFileTranscription(
  blobUrl: string,
  videoId: string,
  title: string,
): Promise<void> {
  await ensureOffscreen();
  await chrome.runtime.sendMessage({
    type: "offscreen-transcribe-file",
    blobUrl,
    videoId,
    title,
  });
}

export async function stopTranscription(): Promise<void> {
  await chrome.runtime.sendMessage({ type: "offscreen-stop-capture" });
}

async function startPendingCaptureFromAction(tab: chrome.tabs.Tab): Promise<boolean> {
  if (tab.id === undefined) return false;
  const pending = await getPendingCapture(tab.id);
  if (!pending) return false;

  const response = await startCapture(tab, pending).catch(errorResponse);
  if (response.status === "error") {
    await clearPendingCapture(tab.id);
    broadcast({
      type: "transcription-error",
      videoId: pending.videoId,
      error: response.error,
    });
  }
  return true;
}

export function handleActionClick(tab: chrome.tabs.Tab): Promise<boolean> {
  return startPendingCaptureFromAction(tab);
}

export async function finishTabTranscription(videoId?: string): Promise<void> {
  if (!videoId) return;
  const active = await getActiveCapture();
  if (!active || active.videoId !== videoId) return;
  await chrome.storage.session.remove(ACTIVE_CAPTURE_KEY);
  await clearBadge(active.tabId);
}

export async function handleCapturedTabClosed(tabId: number): Promise<void> {
  await chrome.storage.session.remove(pendingCaptureKey(tabId));
  const active = await getActiveCapture();
  if (active?.tabId === tabId) {
    await chrome.storage.session.remove(ACTIVE_CAPTURE_KEY);
    await stopTranscription();
  }
}
