/**
 * The side panel is the default entry from the manifest, one per window.
 * sidePanel.open must be the first call after the action click: any await
 * before it consumes the user gesture and the open is rejected (seen in Edge).
 */
export async function openExtensionPanel(tabId: number): Promise<void> {
  await chrome.sidePanel.open({ tabId });
}
