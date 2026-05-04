interface ErrorMessageProps {
    error: string;
    message: string;
    onRetry: () => void;
    onTranscribeLocal?: () => void;
}

const HEADINGS: Record<string, { heading: string; description: string }> = {
    no_captions: {
        heading: "No transcript",
        description: "This video doesn't have subtitles.",
    },
    fetch_failed: {
        heading: "YouTube blocked the transcript",
        description: "Some videos (often VEVO music videos on signed-in Premium) gate their transcript behind tokens we can't reach from an extension. You can transcribe the audio locally instead.",
    },
    unavailable: {
        heading: "Video unavailable",
        description: "Private, restricted, or removed.",
    },
    rate_limited: {
        heading: "Rate limited",
        description: "YouTube is rate-limiting requests. Wait a moment.",
    },
    invalid_id: {
        heading: "Invalid URL",
        description: "Paste the full YouTube or Vimeo link.",
    },
};

const FALLBACK = { heading: "Something went wrong", description: "Try again." };

export function ErrorMessage({error, message, onRetry, onTranscribeLocal}: ErrorMessageProps) {
    const config = HEADINGS[error] ?? FALLBACK;
    // Prefer the more informative description: ours when it's specific, else the server message.
    const isFetchFailedDefault = error === "fetch_failed";
    const description = isFetchFailedDefault
        ? config.description
        : (message && message !== config.description ? message : config.description);

    return (
        <div className="mx-auto mt-8 max-w-md text-center" role="alert">
            <h2 className="mb-1 text-base font-medium text-slate-900 dark:text-white">{config.heading}</h2>
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{description}</p>
            <div className="flex justify-center gap-2">
                <button
                    onClick={onRetry}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                    Try again
                </button>
                {onTranscribeLocal && (
                    <button
                        onClick={onTranscribeLocal}
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                        Transcribe locally
                    </button>
                )}
            </div>
        </div>
    );
}
