import type {HistoryEntry} from "../../types/transcript";

const STORAGE_KEY = "history";
const MAX_ENTRIES = 50;

export async function getHistory(): Promise<HistoryEntry[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY] as HistoryEntry[] | undefined;
    return stored ?? [];
}

export async function addToHistory(entry: HistoryEntry): Promise<void> {
    const entries = (await getHistory()).filter((e) => e.videoId !== entry.videoId);
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    await chrome.storage.local.set({[STORAGE_KEY]: entries});
}

export async function clearHistory(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEY);
}
