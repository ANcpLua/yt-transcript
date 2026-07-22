import type {Preferences} from "../../types/transcript";

const PREFS_KEY = "preferences";

const DEFAULTS: Preferences = {
    aiProvider: "chrome-ai",
};

export async function getPreferences(): Promise<Preferences> {
    const result = await chrome.storage.sync.get(PREFS_KEY);
    const stored = result[PREFS_KEY] as Partial<Preferences> | undefined;
    return {aiProvider: stored?.aiProvider ?? DEFAULTS.aiProvider};
}

export async function savePreferences(prefs: Partial<Preferences>): Promise<void> {
    const current = await getPreferences();
    const merged: Preferences = {aiProvider: prefs.aiProvider ?? current.aiProvider};
    await chrome.storage.sync.set({[PREFS_KEY]: merged});
}
