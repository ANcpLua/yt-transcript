import type {TabTranscriptionResponse} from "../../types/messages";

const UNSUPPORTED = "On-device audio transcription is unavailable in Firefox.";

export async function startActiveTabTranscription(): Promise<TabTranscriptionResponse> {
  return {status: "error", error: UNSUPPORTED};
}

export async function getTabTranscriptionState(): Promise<TabTranscriptionResponse> {
  return {status: "idle"};
}

export async function cancelPendingTranscription(_tabId: number): Promise<void> {}

export async function startFileTranscription(
  _blobUrl: string,
  _videoId: string,
  _title: string,
): Promise<void> {
  throw new Error(UNSUPPORTED);
}

export async function stopTranscription(): Promise<void> {}

export async function finishTabTranscription(_videoId?: string): Promise<void> {}

export async function handleCapturedTabClosed(_tabId: number): Promise<void> {}

export async function handleActionClick(_tab: chrome.tabs.Tab): Promise<boolean> {
  return false;
}
