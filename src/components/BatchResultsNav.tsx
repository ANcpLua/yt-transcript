interface BatchResultsNavProps {
    items: Array<{ videoId: string; title: string }>;
    activeVideoId: string | null;
    onSelect: (videoId: string) => void;
    onBackToBatch: () => void;
}

export function BatchResultsNav({items, activeVideoId, onSelect, onBackToBatch}: BatchResultsNavProps): React.JSX.Element {
    return (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
            <button
                type="button"
                onClick={onBackToBatch}
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            >
                &larr; Batch
            </button>
            <div className="h-4 w-px bg-slate-200 dark:bg-slate-600"/>
            <div className="flex flex-1 gap-1 overflow-x-auto">
                {items.map(item => (
                    <button
                        key={item.videoId}
                        type="button"
                        onClick={() => onSelect(item.videoId)}
                        title={item.title}
                        className={`shrink-0 truncate rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            activeVideoId === item.videoId
                                ? "bg-blue-600 text-white"
                                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
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
