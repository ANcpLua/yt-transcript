import {useCallback, useEffect, useState} from "react";
import {deleteSaved, getAllSaved} from "../lib/storage/saved";
import type {SavedTranscript} from "../types/transcript";

interface SavedListProps {
    onLoadSaved: (transcript: SavedTranscript) => void;
    isOpen: boolean;
    onClose: () => void;
}

export function SavedList({onLoadSaved, isOpen, onClose}: SavedListProps) {
    const [items, setItems] = useState<SavedTranscript[]>([]);
    const [tagFilter, setTagFilter] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            getAllSaved().then(setItems);
        }
    }, [isOpen]);

    const allTags = [...new Set(items.flatMap((t) => t.tags))].sort();

    const filtered = tagFilter ? items.filter((t) => t.tags.includes(tagFilter)) : items;

    const handleDelete = useCallback(
        async (videoId: string, e: React.MouseEvent) => {
            e.stopPropagation();
            if (!confirm("Delete this saved transcript?")) return;
            await deleteSaved(videoId);
            setItems((prev) => prev.filter((t) => t.videoId !== videoId));
        },
        [],
    );

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm py-10" onClick={onClose}>
            <div
                className="mx-4 flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl dark:bg-slate-900 dark:ring-1 dark:ring-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <h2 className="text-base font-medium text-slate-900 dark:text-white">Saved</h2>
                    <button onClick={onClose} aria-label="Close" className="-m-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>

                {/* Tag filter */}
                {allTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                        <button
                            onClick={() => setTagFilter(null)}
                            className={`rounded-md px-2 py-0.5 text-xs transition ${
                                tagFilter === null
                                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                                    : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                            }`}
                        >
                            All
                        </button>
                        {allTags.map((tag) => (
                            <button
                                key={tag}
                                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                                className={`rounded-md px-2 py-0.5 text-xs transition ${
                                    tagFilter === tag
                                        ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                                        : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                                }`}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto px-2 py-2">
                    {filtered.length === 0 ? (
                        <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                            {items.length === 0 ? "Nothing saved yet." : "No matches."}
                        </p>
                    ) : (
                        filtered.map((item) => (
                            <div
                                key={item.videoId}
                                onClick={() => { onLoadSaved(item); onClose(); }}
                                className="group flex cursor-pointer items-start justify-between rounded-lg p-3 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm text-slate-900 dark:text-white">
                                        {item.title}
                                    </p>
                                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                        {item.segments.length.toLocaleString()} segments · {new Date(item.savedAt).toLocaleDateString()}
                                    </p>
                                    {item.tags.length > 0 && (
                                        <div className="mt-1.5 flex flex-wrap gap-1">
                                            {item.tags.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={(e) => handleDelete(item.videoId, e)}
                                    className="ml-2 shrink-0 rounded-md p-1 text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-red-500 group-hover:opacity-100 dark:text-slate-600 dark:hover:bg-slate-700"
                                    aria-label="Delete"
                                >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                    </svg>
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
