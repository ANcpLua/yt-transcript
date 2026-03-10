import type {HistoryEntry} from "../../types/transcript";

const STORAGE_KEY = "yt-transcript:history";
const MAX_ENTRIES = 50;

export function getHistory(): HistoryEntry[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
    } catch {
        return [];
    }
}

export function addToHistory(entry: HistoryEntry): void {
    const entries = getHistory().filter((e) => e.videoId !== entry.videoId);
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function clearHistory(): void {
    localStorage.removeItem(STORAGE_KEY);
}
