import {type FormEvent, useCallback, useRef, useState} from "react";
import {parseVideoId, parsePlaylistId, parseChannelHandle} from "../lib/parseUrl";

interface UrlInputProps {
    onSubmit: (videoId: string) => void;
    onSubmitBatch: (videoIds: string[]) => void;
    isLoading: boolean;
    hasTranscript: boolean;
}

export function UrlInput({onSubmit, onSubmitBatch, isLoading, hasTranscript}: UrlInputProps) {
    const [url, setUrl] = useState("");
    const [validationError, setValidationError] = useState("");
    const [videoList, setVideoList] = useState<{videoId: string; title: string; selected: boolean}[]>([]);
    const [listTitle, setListTitle] = useState("");
    const [loadingList, setLoadingList] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleSubmit = useCallback(async (e: FormEvent) => {
        e.preventDefault();

        // Check for playlist first
        const playlistId = parsePlaylistId(url);
        if (playlistId) {
            setLoadingList(true);
            try {
                const res = await fetch(`/api/playlist?id=${encodeURIComponent(playlistId)}`);
                if (res.ok) {
                    const data = await res.json() as {playlistTitle: string; videos: {videoId: string; title: string}[]};
                    setVideoList(data.videos.map(v => ({...v, selected: true})));
                    setListTitle(data.playlistTitle);
                }
            } catch { /* network error — list simply won't appear */ }
            setLoadingList(false);
            return;
        }

        // Check for channel
        const channelHandle = parseChannelHandle(url);
        if (channelHandle) {
            setLoadingList(true);
            try {
                const res = await fetch(`/api/channel?handle=${encodeURIComponent(channelHandle)}`);
                if (res.ok) {
                    const data = await res.json() as {channelTitle: string; videos: {videoId: string; title: string}[]};
                    setVideoList(data.videos.map(v => ({...v, selected: true})));
                    setListTitle(data.channelTitle);
                }
            } catch { /* network error — list simply won't appear */ }
            setLoadingList(false);
            return;
        }

        // Regular video ID
        const videoId = parseVideoId(url);
        if (!videoId) {
            setValidationError("Enter a valid YouTube URL");
            return;
        }
        setValidationError("");
        onSubmit(videoId);
    }, [url, onSubmit]);

    const handleChange = useCallback((value: string) => {
        setUrl(value);
        if (value.length > 0) setValidationError("");
    }, []);

    const videoSelectionPanel = videoList.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{listTitle}</h3>
                <div className="flex gap-2">
                    <button type="button" onClick={() => setVideoList(v => v.map(i => ({...i, selected: true})))}
                        className="text-xs text-blue-600 hover:underline dark:text-blue-400">Select All</button>
                    <button type="button" onClick={() => setVideoList(v => v.map(i => ({...i, selected: false})))}
                        className="text-xs text-blue-600 hover:underline dark:text-blue-400">Deselect All</button>
                </div>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
                {videoList.map((v, i) => (
                    <label key={v.videoId} className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-700">
                        <input type="checkbox" checked={v.selected}
                            onChange={() => setVideoList(prev => prev.map((item, j) => j === i ? {...item, selected: !item.selected} : item))}
                            className="rounded-sm" />
                        <span className="truncate text-sm text-slate-700 dark:text-slate-300">{v.title}</span>
                    </label>
                ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-slate-500">{videoList.filter(v => v.selected).length} of {videoList.length} selected</span>
                <div className="flex gap-2">
                    <button type="button" onClick={() => setVideoList([])}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-600 dark:text-slate-300">Cancel</button>
                    <button type="button"
                        onClick={() => {
                            const ids = videoList.filter(v => v.selected).map(v => v.videoId);
                            if (ids.length > 0) onSubmitBatch(ids);
                            setVideoList([]);
                        }}
                        disabled={videoList.filter(v => v.selected).length === 0}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                        Get Transcripts ({videoList.filter(v => v.selected).length})
                    </button>
                </div>
            </div>
        </div>
    );

    // Landing state: centered with tagline and features
    if (!hasTranscript && !isLoading) {
        return (
            <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4">
                <h1 className="mb-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-4xl">
                    YouTube Transcript Extractor
                </h1>
                <p className="mb-8 text-center text-lg text-slate-600 dark:text-slate-400">
                    Extract, search, and export YouTube transcripts. Free. No signup.
                </p>

                <form onSubmit={(e) => void handleSubmit(e)} className="mb-8 w-full">
                    <div className="flex gap-2">
                        <input
                            ref={inputRef}
                            type="text"
                            value={url}
                            onChange={(e) => handleChange(e.target.value)}
                            placeholder="Paste a YouTube URL, playlist, or channel..."
                            disabled={isLoading || loadingList}
                            aria-label="YouTube URL"
                            aria-invalid={validationError.length > 0}
                            className={`min-h-[48px] flex-1 rounded-xl border-2 bg-white px-4 py-3 text-base shadow-xs transition-colors placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 ${
                                validationError ? "border-red-400 dark:border-red-500" : "border-slate-200 dark:border-slate-600"
                            }`}
                        />
                        <button
                            type="submit"
                            disabled={isLoading || loadingList || url.length === 0}
                            className="min-h-[48px] whitespace-nowrap rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-offset-slate-900"
                        >
                            {loadingList ? "Loading..." : "Get Transcript"}
                        </button>
                    </div>
                    {validationError && (
                        <p className="mt-2 text-sm text-red-500 dark:text-red-400" role="alert">
                            {validationError}
                        </p>
                    )}
                </form>

                {videoSelectionPanel}

                <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
                    <FeatureCard title="Instant Extraction"
                                 description="Paste any YouTube URL and get the full transcript in seconds."/>
                    <FeatureCard title="Search & Export"
                                 description="Search within transcripts. Download as TXT, SRT, VTT, JSON, CSV, or Markdown."/>
                    <FeatureCard title="100% Free"
                                 description="No accounts, no credit limits, no tracking. Works immediately."/>
                </div>
            </div>
        );
    }

    // Compact input when transcript is loaded or loading
    return (
        <>
            <form onSubmit={(e) => void handleSubmit(e)} className="mb-4">
                <div className="flex gap-2">
                    <input
                        ref={inputRef}
                        type="text"
                        value={url}
                        onChange={(e) => handleChange(e.target.value)}
                        placeholder="Paste a YouTube URL, playlist, or channel..."
                        disabled={isLoading || loadingList}
                        aria-label="YouTube URL"
                        aria-invalid={validationError.length > 0}
                        className={`min-h-[44px] flex-1 rounded-lg border-2 bg-white px-4 py-2 text-sm shadow-xs transition-colors placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 ${
                            validationError ? "border-red-400 dark:border-red-500" : "border-slate-200 dark:border-slate-600"
                        }`}
                    />
                    <button
                        type="submit"
                        disabled={isLoading || loadingList || url.length === 0}
                        className="min-h-[44px] whitespace-nowrap rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-offset-slate-900"
                    >
                        {loadingList ? "Loading..." : isLoading ? "Loading..." : "Get Transcript"}
                    </button>
                </div>
                {validationError && (
                    <p className="mt-1.5 text-sm text-red-500 dark:text-red-400" role="alert">
                        {validationError}
                    </p>
                )}
            </form>
            {videoSelectionPanel}
        </>
    );
}

function FeatureCard({title, description}: { title: string; description: string }) {
    return (
        <div
            className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-xs dark:border-slate-700 dark:bg-slate-800">
            <h3 className="mb-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{description}</p>
        </div>
    );
}
