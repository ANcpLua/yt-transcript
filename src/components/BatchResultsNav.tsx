interface BatchResultsNavProps {
    items: Array<{ videoId: string; title: string }>;
    activeVideoId: string | null;
    onSelect: (videoId: string) => void;
    onBackToBatch: () => void;
}

export function BatchResultsNav({items, activeVideoId, onSelect, onBackToBatch}: BatchResultsNavProps): React.JSX.Element {
    return (
        <div className="mb-3 flex items-center gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
            <button
                type="button"
                onClick={onBackToBatch}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            >
                ← Batch
            </button>
            <div className="flex flex-1 gap-0.5 overflow-x-auto">
                {items.map(item => (
                    <button
                        key={item.videoId}
                        type="button"
                        onClick={() => onSelect(item.videoId)}
                        title={item.title}
                        className={`shrink-0 truncate rounded-md px-2 py-1 text-xs transition ${
                            activeVideoId === item.videoId
                                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                        }`}
                        style={{maxWidth: "150px"}}
                    >
                        {item.title}
                    </button>
                ))}
            </div>
        </div>
    );
}
