import type {BatchState} from "../lib/batch/queue";

interface BatchProgressProps {
    batchState: BatchState;
    onRetry: () => void;
    onCancel: () => void;
    onViewResult: (videoId: string) => void;
    onExport: (format: string, mode: "separate" | "merged") => void;
}

const FORMATS = ["txt", "srt", "vtt", "json", "csv"] as const;

function statusIcon(status: string): string {
    switch (status) {
        case "success":
            return "\u2713";
        case "failed":
            return "\u2717";
        case "processing":
            return "\u25CB";
        default:
            return "\u2014";
    }
}

function statusColor(status: string): string {
    switch (status) {
        case "success":
            return "text-green-600 dark:text-green-400";
        case "failed":
            return "text-red-600 dark:text-red-400";
        case "processing":
            return "text-blue-600 dark:text-blue-400 animate-pulse";
        default:
            return "text-slate-400 dark:text-slate-500";
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
        <div className="w-full max-w-3xl mx-auto space-y-4">
            {/* Progress bar */}
            <div>
                <div className="flex justify-between text-sm text-slate-600 dark:text-slate-300 mb-1">
          <span>
            {done} of {total} completed
              {failedCount > 0 && (
                  <span className="text-red-600 dark:text-red-400 ml-1">
                ({failedCount} failed)
              </span>
              )}
          </span>
                    <span>{pct}%</span>
                </div>
                <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-300"
                        style={{width: `${pct}%`}}
                    />
                </div>
            </div>

            {/* Item list */}
            <div
                className="max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-700">
                {items.map((item) => (
                    <div
                        key={item.videoId}
                        className="flex items-center gap-3 px-4 py-2 text-sm"
                    >
            <span className={`flex-shrink-0 font-mono ${statusColor(item.status)}`}>
              {statusIcon(item.status)}
            </span>
                        <span className="flex-1 truncate text-slate-800 dark:text-slate-200">
              {item.title ?? item.videoId}
            </span>
                        {item.status === "failed" && item.error && (
                            <span className="text-xs text-red-500 dark:text-red-400 truncate max-w-48">
                {item.error}
              </span>
                        )}
                        {item.status === "success" && (
                            <button
                                type="button"
                                onClick={() => onViewResult(item.videoId)}
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
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
                        className="px-4 py-2 text-sm bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                    >
                        Cancel
                    </button>
                ) : (
                    <>
                        {failedCount > 0 && (
                            <button
                                type="button"
                                onClick={onRetry}
                                className="px-4 py-2 text-sm bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                            >
                                Retry Failed ({failedCount})
                            </button>
                        )}

                        {completedCount > 0 && (
                            <div className="flex items-center gap-2 ml-auto">
                                {FORMATS.map((fmt) => (
                                    <div key={fmt} className="flex gap-1">
                                        <button
                                            type="button"
                                            onClick={() => onExport(fmt, "separate")}
                                            className="px-3 py-1.5 text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                                            title={`Download as separate ${fmt.toUpperCase()} files (ZIP)`}
                                        >
                                            .{fmt}
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => onExport("txt", "merged")}
                                    className="px-3 py-1.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-sm hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                                    title="Download all as one merged file"
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
