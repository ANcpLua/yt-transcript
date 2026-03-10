import type {NoteEntry, SavedTranscript} from "../../types/transcript";

const DB_NAME = "yt-transcript-db";
const STORE_NAME = "saved-transcripts";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, {keyPath: "videoId"});
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function txn<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    return openDb().then(
        (db) =>
            new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, mode);
                const result = fn(tx.objectStore(STORE_NAME));
                result.onsuccess = () => resolve(result.result);
                result.onerror = () => reject(result.error);
                tx.oncomplete = () => db.close();
            }),
    );
}

export function saveTranscript(transcript: SavedTranscript): Promise<void> {
    return txn("readwrite", (store) => store.put(transcript)).then(() => undefined);
}

export function getSavedTranscript(
    videoId: string,
): Promise<SavedTranscript | undefined> {
    return txn<SavedTranscript | undefined>("readonly", (store) => store.get(videoId));
}

export function getAllSaved(): Promise<SavedTranscript[]> {
    return txn<SavedTranscript[]>("readonly", (store) => store.getAll());
}

export function deleteSaved(videoId: string): Promise<void> {
    return txn("readwrite", (store) => store.delete(videoId)).then(() => undefined);
}

async function patchSaved<K extends keyof SavedTranscript>(
    videoId: string,
    key: K,
    value: SavedTranscript[K],
): Promise<void> {
    const existing = await getSavedTranscript(videoId);
    if (!existing) return;
    await saveTranscript({...existing, [key]: value});
}

export function updateHighlights(
    videoId: string,
    highlights: number[],
): Promise<void> {
    return patchSaved(videoId, "highlights", highlights);
}

export function updateNotes(
    videoId: string,
    notes: NoteEntry[],
): Promise<void> {
    return patchSaved(videoId, "notes", notes);
}

export function updateTags(
    videoId: string,
    tags: string[],
): Promise<void> {
    return patchSaved(videoId, "tags", tags);
}

export async function exportAllData(): Promise<string> {
    const all = await getAllSaved();
    return JSON.stringify(all, null, 2);
}

export async function clearAllData(): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const req = tx.objectStore(STORE_NAME).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
    });
}
