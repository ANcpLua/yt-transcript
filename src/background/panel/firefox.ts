type FirefoxSidebarAction = {
  open(): Promise<void>;
};

export async function openExtensionPanel(_tabId: number): Promise<void> {
  const sidebarAction = (chrome as typeof chrome & {
    sidebarAction?: FirefoxSidebarAction;
  }).sidebarAction;
  if (!sidebarAction?.open) {
    throw new Error("Firefox did not provide the extension sidebar API.");
  }
  await sidebarAction.open();
}
