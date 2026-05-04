import type {BatchState} from "../lib/batch/queue";

interface BatchProgressProps {
    batchState: BatchState;
    onRetry: () => void;
    onCancel: () => void;
    onViewResult: (videoId: string) => void;
    onExport: (format: string, mode: "separate" | "merged") => void;
}

const FORMATS = ["txt", "srt", "vtt", "json", "csv"] as const;

function statusDot(status: string): string {
    switch (status) {
        case "success":
            return "bg-emerald-500";
        case "failed":
            return "bg-red-500";
        case "processing":
            return "bg-slate-400 animate-pulse";
        default:
            return "bg-slate-200 dark:bg-slate-700";
    }
}

export function BatchProgress({
                                  batchState,
                                  onRetry,
                                  onCancel,
                                  onViewResult,
                                  onExport,
                              }: BatchProgressProps): React.JSX.Element {
    const {items, isProcessing, completedCount, failedCount} = batchState;
    const total = items.length;
    const done = completedCount + failedCount;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
        <div className="mx-auto w-full max-w-3xl space-y-4">
            {/* Progress */}
            <div>
                <div className="mb-1.5 flex items-baseline justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>
                        {done} of {total}
                        {failedCount > 0 && <span className="ml-1.5 text-red-500 dark:text-red-400">{failedCount} failed</span>}
                    </span>
                    <span className="tabular-nums">{pct}%</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                        className="h-full rounded-full bg-slate-500 transition-all duration-300 dark:bg-slate-400"
                        style={{width: `${pct}%`}}
                    />
                </div>
            </div>

            {/* Item list */}
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
                {items.map((item) => (
                    <div
                        key={item.videoId}
                        className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 dark:border-slate-800/60"
                    >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(item.status)}`} aria-label={item.status}/>
                        <span className="flex-1 truncate text-slate-700 dark:text-slate-300">
                            {item.title ?? item.videoId}
                        </span>
                        {item.status === "failed" && item.error && (
                            <span className="max-w-48 truncate text-xs text-red-500 dark:text-red-400">
                                {item.error}
                            </span>
                        )}
                        {item.status === "success" && (
                            <button
                                type="button"
                                onClick={() => onViewResult(item.videoId)}
                                className="shrink-0 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                            >
                                View
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3">
                {isProcessing ? (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                        Cancel
                    </button>
                ) : (
                    <>
                        {failedCount > 0 && (
                            <button
                                type="button"
                                onClick={onRetry}
                                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                                Retry failed ({failedCount})
                            </button>
                        )}

                        {completedCount > 0 && (
                            <div className="ml-auto flex items-center gap-1">
                                {FORMATS.map((fmt) => (
                                    <button
                                        key={fmt}
                                        type="button"
                                        onClick={() => onExport(fmt, "separate")}
                                        title={`Download separate ${fmt.toUpperCase()} files`}
                                        className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                                    >
                                        .{fmt}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => onExport("txt", "merged")}
                                    title="Download all merged into one file"
                                    className="ml-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                                >
                                    Merged
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
