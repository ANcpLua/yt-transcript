interface ErrorMessageProps {
    error: string;
    message: string;
    onRetry: () => void;
}

const ERROR_CONFIG: Record<string, { icon: string; heading: string; description: string }> = {
    no_captions: {
        icon: "subtitles_off",
        heading: "No Captions Available",
        description: "This video doesn't have captions. Try a video where the creator has enabled captions.",
    },
    unavailable: {
        icon: "block",
        heading: "Video Unavailable",
        description: "This video is private, restricted, or doesn't exist.",
    },
    rate_limited: {
        icon: "schedule",
        heading: "Temporarily Limited",
        description: "YouTube is rate-limiting requests. Wait a moment and try again.",
    },
    invalid_id: {
        icon: "link_off",
        heading: "Invalid URL",
        description: "That doesn't look like a YouTube URL. Try pasting the full link.",
    },
};

const FALLBACK = {
    icon: "error",
    heading: "Something Went Wrong",
    description: "Please try again.",
};

export function ErrorMessage({error, message, onRetry}: ErrorMessageProps) {
    const config = ERROR_CONFIG[error] ?? FALLBACK;
    // Use the server message if it's more specific than our generic one
    const description = message && message !== config.description ? message : config.description;

    return (
        <div
            className="mx-auto max-w-md rounded-xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-800 dark:bg-red-950/30"
            role="alert">
            <div
                className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-3xl dark:bg-red-900/50">
                {config.icon === "subtitles_off" && <SubtitlesOffIcon/>}
                {config.icon === "block" && <BlockIcon/>}
                {config.icon === "schedule" && <ClockIcon/>}
                {config.icon === "link_off" && <LinkOffIcon/>}
                {config.icon === "error" && <ErrorIcon/>}
            </div>
            <h2 className="mb-2 text-lg font-semibold text-red-900 dark:text-red-200">{config.heading}</h2>
            <p className="mb-6 text-sm text-red-700 dark:text-red-300">{description}</p>
            <button
                onClick={onRetry}
                className="rounded-lg bg-red-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
            >
                Try Again
            </button>
        </div>
    );
}

// Inline SVG icons to avoid external dependencies

function SubtitlesOffIcon() {
    return (
        <svg className="h-8 w-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
                  d="M3 3l18 18M7 8H4a1 1 0 00-1 1v6a1 1 0 001 1h3m10-8h3a1 1 0 011 1v6a1 1 0 01-1 1h-3M9 13h2m4 0h2"/>
        </svg>
    );
}

function BlockIcon() {
    return (
        <svg className="h-8 w-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>
        </svg>
    );
}

function ClockIcon() {
    return (
        <svg className="h-8 w-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
    );
}

function LinkOffIcon() {
    return (
        <svg className="h-8 w-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
                  d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.51a4.5 4.5 0 00-6.364-6.364L6.659 5.55"/>
        </svg>
    );
}

function ErrorIcon() {
    return (
        <svg className="h-8 w-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
        </svg>
    );
}
