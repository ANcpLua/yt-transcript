import {useMemo, useState} from "react";
import {parseVideoId} from "../lib/parseUrl";

interface BatchInputProps {
    onSingleSubmit: (videoId: string) => void;
    onBatchStart: (videoIds: string[]) => void;
    isLoading: boolean;
}

const MAX_URLS = 25;

interface ParsedLine {
    raw: string;
    videoId: string | null;
}

export function BatchInput({onSingleSubmit, onBatchStart, isLoading}: BatchInputProps): React.JSX.Element {
    const [mode, setMode] = useState<"single" | "batch">("single");
    const [singleUrl, setSingleUrl] = useState("");
    const [batchText, setBatchText] = useState("");

    const parsedLines = useMemo((): ParsedLine[] => {
        if (!batchText.trim()) return [];
        return batchText
            .split("\n")
            .map((raw) => raw.trim())
            .filter((raw) => raw.length > 0)
            .map((raw) => ({raw, videoId: parseVideoId(raw)}));
    }, [batchText]);

    const validIds = useMemo(
        () => parsedLines.filter((l) => l.videoId !== null).map((l) => l.videoId as string),
        [parsedLines],
    );

    const handleSingleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        const id = parseVideoId(singleUrl);
        if (id) onSingleSubmit(id);
    };

    const handleBatchSubmit = (): void => {
        if (validIds.length > 0 && validIds.length <= MAX_URLS) {
            onBatchStart(validIds);
        }
    };

    return (
        <div className="w-full max-w-3xl mx-auto">
            {/* Mode tabs */}
            <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
                <button
                    type="button"
                    onClick={() => setMode("single")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        mode === "single"
                            ? "border-blue-500 text-blue-600 dark:text-blue-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
                    }`}
                >
                    Single Video
                </button>
                <button
                    type="button"
                    onClick={() => setMode("batch")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        mode === "batch"
                            ? "border-blue-500 text-blue-600 dark:text-blue-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
                    }`}
                >
                    Batch
                </button>
            </div>

            {mode === "single" ? (
                <form onSubmit={handleSingleSubmit} className="flex gap-2">
                    <input
                        type="text"
                        value={singleUrl}
                        onChange={(e) => setSingleUrl(e.target.value)}
                        placeholder="Paste YouTube URL or video ID..."
                        className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !parseVideoId(singleUrl)}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isLoading ? "Loading..." : "Get Transcript"}
                    </button>
                </form>
            ) : (
                <div className="space-y-3">
          <textarea
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder={"Paste YouTube URLs, one per line...\n\nhttps://youtube.com/watch?v=...\nhttps://youtu.be/..."}
              rows={6}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 resize-y"
              disabled={isLoading}
          />

                    {/* Parsed preview */}
                    {parsedLines.length > 0 && (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                            {parsedLines.map((line, i) => (
                                <div
                                    key={i}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-sm ${
                                        line.videoId
                                            ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300"
                                            : "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300"
                                    }`}
                                >
                                    <span className="flex-shrink-0">{line.videoId ? "\u2713" : "\u2717"}</span>
                                    <span className="truncate">{line.raw}</span>
                                    {line.videoId && (
                                        <span className="ml-auto flex-shrink-0 font-mono text-xs opacity-60">
                      {line.videoId}
                    </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Footer: count + submit */}
                    <div className="flex items-center justify-between">
            <span
                className={`text-sm ${
                    parsedLines.length > MAX_URLS ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"
                }`}
            >
              {validIds.length} valid of {parsedLines.length} URLs (max {MAX_URLS})
            </span>
                        <button
                            type="button"
                            onClick={handleBatchSubmit}
                            disabled={isLoading || validIds.length === 0 || parsedLines.length > MAX_URLS}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Start Batch ({validIds.length})
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
