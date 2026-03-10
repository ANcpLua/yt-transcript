export function LoadingSpinner() {
    return (
        <div className="animate-pulse space-y-4 p-4" role="status" aria-label="Loading transcript">
            {/* Title skeleton */}
            <div className="h-6 w-2/3 rounded-sm bg-slate-200 dark:bg-slate-700"/>
            {/* Metadata skeleton */}
            <div className="flex gap-3">
                <div className="h-5 w-20 rounded-full bg-slate-200 dark:bg-slate-700"/>
                <div className="h-5 w-24 rounded-full bg-slate-200 dark:bg-slate-700"/>
                <div className="h-5 w-16 rounded-full bg-slate-200 dark:bg-slate-700"/>
            </div>
            {/* Line skeletons */}
            {Array.from({length: 12}, (_, i) => (
                <div key={i} className="flex gap-2">
                    <div className="h-4 w-12 shrink-0 rounded-sm bg-slate-200 dark:bg-slate-700"/>
                    <div
                        className="h-4 rounded-sm bg-slate-200 dark:bg-slate-700"
                        style={{width: `${60 + Math.floor(Math.random() * 35)}%`}}
                    />
                </div>
            ))}
            <span className="sr-only">Loading transcript...</span>
        </div>
    );
}
