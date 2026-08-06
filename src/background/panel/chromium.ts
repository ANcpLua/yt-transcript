export async function openExtensionPanel(tabId: number): Promise<void> {
  await chrome.sidePanel.open({tabId});
}
