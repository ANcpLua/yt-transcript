const PANEL_PATH = "sidepanel/index.html";

/**
 * The panel is tab-specific: it is disabled by default and enabled per tab
 * when the user invokes the action there. A pasted URL opens a new tab with
 * a SCAN badge; the panel follows that tab only once the user clicks the
 * action on it, which is also the click that grants activeTab.
 */
export function initializeExtensionPanel(): void {
  void chrome.sidePanel.setOptions({ enabled: false }).catch(() => undefined);
}

export async function enablePanelForTab(tabId: number): Promise<void> {
  await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
}

export async function openExtensionPanel(tabId: number): Promise<void> {
  await enablePanelForTab(tabId);
  await chrome.sidePanel.open({ tabId });
}
