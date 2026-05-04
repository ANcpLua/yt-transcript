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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm py-10" onClick={onClose}>
            <div
                className="mx-4 flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-xl dark:bg-slate-900 dark:ring-1 dark:ring-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                    <h2 className="text-base font-medium text-slate-900 dark:text-white">History</h2>
                    <div className="flex items-center gap-3">
                        {entries.length > 0 && (
                            <button onClick={handleClear} className="text-xs text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400">
                                Clear all
                            </button>
                        )}
                        <button onClick={onClose} aria-label="Close" className="-m-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-2 py-2">
                    {entries.length === 0 ? (
                        <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">Nothing yet.</p>
                    ) : (
                        entries.map((entry) => (
                            <button
                                key={entry.videoId + entry.fetchedAt}
                                onClick={() => {
                                    onSelectVideo(entry.videoId);
                                    onClose();
                                }}
                                className="flex w-full gap-3 rounded-lg p-2 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <img
                                    src={entry.thumbnailUrl}
                                    alt=""
                                    className="h-14 w-24 shrink-0 rounded-md object-cover"
                                    loading="lazy"
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm text-slate-900 dark:text-white">
                                        {entry.title}
                                    </p>
                                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                        {entry.wordCount.toLocaleString()} words · {new Date(entry.fetchedAt).toLocaleDateString()}
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
