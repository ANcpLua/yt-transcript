interface ErrorMessageProps {
    error: string;
    message: string;
    onRetry: () => void;
    onOpenOriginal?: () => void;
    onTranscribeLocal?: () => void;
}

const HEADINGS: Record<string, { heading: string; description: string }> = {
    no_captions: {
        heading: "No transcript",
        description: "This video doesn't have subtitles.",
    },
    fetch_failed: {
        heading: "Couldn't fetch transcript",
        description: "Some videos (premium-gated, age-restricted, region-locked) need an authenticated session we can't replicate from a paste-URL flow. Open the video in its own tab and we'll capture the transcript automatically the moment the page loads. Or transcribe the audio locally.",
    },
    unavailable: {
        heading: "Video unavailable",
        description: "Private, restricted, or removed.",
    },
    rate_limited: {
        heading: "Rate limited",
        description: "The video platform is rate-limiting requests. Wait a moment.",
    },
    invalid_id: {
        heading: "Invalid URL",
        description: "Paste a full video link.",
    },
};

const FALLBACK = { heading: "Something went wrong", description: "Try again." };

export function ErrorMessage({error, message, onRetry, onOpenOriginal, onTranscribeLocal}: ErrorMessageProps) {
    const config = HEADINGS[error] ?? FALLBACK;
    // Prefer the more informative description: ours when it's specific, else the server message.
    const isFetchFailedDefault = error === "fetch_failed";
    const description = isFetchFailedDefault
        ? config.description
        : (message && message !== config.description ? message : config.description);

    return (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-center dark:border-slate-700 dark:bg-slate-800/60" role="alert">
            <h2 className="mb-1 text-sm font-semibold text-slate-900 dark:text-white">{config.heading}</h2>
            <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">{description}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
                {onOpenOriginal && (
                    <button
                        onClick={onOpenOriginal}
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                        Open original video
                    </button>
                )}
                <button
                    onClick={onRetry}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                >
                    Try again
                </button>
                {onTranscribeLocal && (
                    <button
                        onClick={onTranscribeLocal}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                    >
                        Transcribe locally
                    </button>
                )}
            </div>
        </div>
    );
}
