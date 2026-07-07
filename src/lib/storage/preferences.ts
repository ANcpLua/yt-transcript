import type {Preferences} from "../../types/transcript";

const PREFS_KEY = "preferences";

const DEFAULTS: Preferences = {
    aiProvider: "chrome-ai",
    whisperModel: "tiny",
};

export async function getPreferences(): Promise<Preferences> {
    const result = await chrome.storage.sync.get(PREFS_KEY);
    const stored = result[PREFS_KEY] as Partial<Preferences> | undefined;
    return {
        aiProvider: "chrome-ai",
        whisperModel: stored?.whisperModel === "base" ? "base" : DEFAULTS.whisperModel,
    };
}

export async function savePreferences(prefs: Partial<Preferences>): Promise<void> {
    const current = await getPreferences();
    const merged: Preferences = {
        aiProvider: "chrome-ai",
        whisperModel: prefs.whisperModel ?? current.whisperModel,
    };
    await chrome.storage.sync.set({[PREFS_KEY]: merged});
}
