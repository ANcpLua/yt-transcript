/**
 * Permission hygiene after an update.
 *
 * Versions before 3.0 declared `webNavigation` and permanent host access to a
 * few media sites. Chrome keeps grants it has already made across updates, so
 * a user coming from those versions would keep access the current manifest
 * never asks for. Everything the current manifest does not require is
 * dropped; optional origins are requested again at the moment a feature needs
 * them.
 */
export function registerInstallHandler(): void {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== "update") return;
    void dropStalePermissions().catch(() => undefined);
  });
}

async function dropStalePermissions(): Promise<void> {
  const granted = await chrome.permissions.getAll();
  const required = new Set(chrome.runtime.getManifest().permissions ?? []);
  const permissions = (granted.permissions ?? []).filter((name) => !required.has(name));
  const origins = granted.origins ?? [];

  for (const permission of permissions) {
    await chrome.permissions.remove({ permissions: [permission] }).catch(() => false);
  }
  for (const origin of origins) {
    const removed = await chrome.permissions.remove({ origins: [origin] }).catch(() => false);
    if (!removed && origin.startsWith("*://")) {
      // Old grants used the wildcard scheme; the current optional patterns
      // spell out http and https separately, so remove both forms.
      await chrome.permissions
        .remove({ origins: [`http${origin.slice(1)}`, `https${origin.slice(1)}`] })
        .catch(() => false);
    }
  }
}
