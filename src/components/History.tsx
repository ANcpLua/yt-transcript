import {useEffect, useState} from "react";
import {clearHistory, getHistory} from "../lib/storage/history";
import type {HistoryEntry} from "../types/transcript";

interface HistoryProps {
    onSelectVideo: (videoId: string) => void;
    isOpen: boolean;
    onClose: () => void;
}

export function History({onSelectVideo, isOpen, onClose}: HistoryProps) {
    const [entries, setEntries] = useState<HistoryEntry[]>([]);

    useEffect(() => {
        if (isOpen) void getHistory().then(setEntries);
    }, [isOpen]);

    const handleClear = () => {
        if (!confirm("Clear all history?")) return;
        void clearHistory().then(() => setEntries([]));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
            <div
                className="mx-4 flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-white shadow-2xl dark:bg-gray-800"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b p-4 dark:border-gray-700">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Recent History</h2>
                    <div className="flex gap-2">
                        {entries.length > 0 && (
                            <button onClick={handleClear} className="text-xs text-red-500 hover:text-red-700">
                                Clear all
                            </button>
                        )}
                        <button onClick={onClose}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                    {entries.length === 0 ? (
                        <p className="p-4 text-center text-sm text-gray-500">No history yet.</p>
                    ) : (
                        entries.map((entry) => (
                            <button
                                key={entry.videoId + entry.fetchedAt}
                                onClick={() => {
                                    onSelectVideo(entry.videoId);
                                    onClose();
                                }}
                                className="flex w-full gap-3 rounded-lg p-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                                <img
                                    src={entry.thumbnailUrl}
                                    alt=""
                                    className="h-14 w-24 shrink-0 rounded-sm object-cover"
                                    loading="lazy"
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                                        {entry.title}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {entry.language} &middot; {entry.segmentCount} segments &middot;{" "}
                                        {entry.wordCount.toLocaleString()} words
                                    </p>
                                    <p className="text-xs text-gray-400 dark:text-gray-500">
                                        {new Date(entry.fetchedAt).toLocaleDateString()}
                                    </p>
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
