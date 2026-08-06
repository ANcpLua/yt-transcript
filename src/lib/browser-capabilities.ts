export function isFirefoxRuntime(): boolean {
  if (__FIREFOX__) return true;
  return chrome.runtime.getURL("").startsWith("moz-extension:");
}

export function supportsOnDeviceTranscription(): boolean {
  if (__FIREFOX__) return false;
  return (
    typeof chrome.runtime.getContexts === "function"
    && typeof chrome.offscreen?.createDocument === "function"
    && typeof chrome.tabCapture?.getMediaStreamId === "function"
  );
}
