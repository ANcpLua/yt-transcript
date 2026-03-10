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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
            <div
                className="mx-4 flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-white shadow-2xl dark:bg-gray-800"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b p-4 dark:border-gray-700">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Saved Transcripts</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>

                {/* Tag filter */}
                {allTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 border-b px-4 py-2 dark:border-gray-700">
                        <button
                            onClick={() => setTagFilter(null)}
                            className={`rounded-full px-2 py-0.5 text-xs ${
                                tagFilter === null
                                    ? "bg-blue-600 text-white"
                                    : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                            }`}
                        >
                            All
                        </button>
                        {allTags.map((tag) => (
                            <button
                                key={tag}
                                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                                className={`rounded-full px-2 py-0.5 text-xs ${
                                    tagFilter === tag
                                        ? "bg-blue-600 text-white"
                                        : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                                }`}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-2">
                    {filtered.length === 0 ? (
                        <p className="p-4 text-center text-sm text-gray-500">
                            {items.length === 0 ? "No saved transcripts." : "No matches for this tag."}
                        </p>
                    ) : (
                        filtered.map((item) => (
                            <div
                                key={item.videoId}
                                onClick={() => {
                                    onLoadSaved(item);
                                    onClose();
                                }}
                                className="flex cursor-pointer items-start justify-between rounded-lg p-3 hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                                        {item.title}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {item.language} &middot; {item.segments.length} segments &middot;{" "}
                                        {new Date(item.savedAt).toLocaleDateString()}
                                    </p>
                                    {item.tags.length > 0 && (
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {item.tags.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                                >
                          {tag}
                        </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={(e) => handleDelete(item.videoId, e)}
                                    className="ml-2 shrink-0 text-gray-400 hover:text-red-500"
                                    aria-label="Delete"
                                >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
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
