import type {Preferences} from "../../types/transcript";

const PREFS_KEY = "preferences";
const API_KEY_PREFIX = "apiKey:";

const DEFAULTS: Preferences = {
    viewMode: "raw",
    showTimestamps: true,
    compactMode: false,
    autoScroll: true,
    aiProvider: null,
    whisperModel: "tiny",
};

export async function getPreferences(): Promise<Preferences> {
    const result = await chrome.storage.sync.get(PREFS_KEY);
    const stored = result[PREFS_KEY] as Partial<Preferences> | undefined;
    return stored ? {...DEFAULTS, ...stored} : DEFAULTS;
}

export async function savePreferences(prefs: Partial<Preferences>): Promise<void> {
    const current = await getPreferences();
    const merged = {...current, ...prefs};
    await chrome.storage.sync.set({[PREFS_KEY]: merged});
}

export async function getApiKey(provider: string): Promise<string | null> {
    const key = `${API_KEY_PREFIX}${provider}`;
    const result = await chrome.storage.local.get(key);
    const value = result[key] as string | undefined;
    return value ?? null;
}

export async function saveApiKey(provider: string, key: string): Promise<void> {
    await chrome.storage.local.set({[`${API_KEY_PREFIX}${provider}`]: key});
}

export async function removeApiKey(provider: string): Promise<void> {
    await chrome.storage.local.remove(`${API_KEY_PREFIX}${provider}`);
}

/** @deprecated Use removeApiKey instead */
export const clearApiKey = removeApiKey;
