import type {Preferences} from "../../types/transcript";

const PREFS_KEY = "yt-transcript:preferences";
const API_KEY_PREFIX = "yt-transcript:apiKey:";

const DEFAULTS: Preferences = {
    viewMode: "raw",
    showTimestamps: true,
    compactMode: false,
    autoScroll: true,
    aiProvider: null,
};

export function getPreferences(): Preferences {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        return raw ? {...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>)} : DEFAULTS;
    } catch {
        return DEFAULTS;
    }
}

export function savePreferences(prefs: Partial<Preferences>): void {
    const merged = {...getPreferences(), ...prefs};
    localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
}

export function getApiKey(provider: string): string | null {
    return localStorage.getItem(`${API_KEY_PREFIX}${provider}`);
}

export function saveApiKey(provider: string, key: string): void {
    localStorage.setItem(`${API_KEY_PREFIX}${provider}`, key);
}

export function clearApiKey(provider: string): void {
    localStorage.removeItem(`${API_KEY_PREFIX}${provider}`);
}
