import {type FormEvent, useCallback, useRef, useState} from "react";
import {parseUrl, parseVideoId} from "../lib/parseUrl";
import type {Platform} from "../types/transcript";

interface UrlInputProps {
    onSubmit: (videoId: string, platform: Platform) => void;
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
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleCsvUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = reader.result as string;
            const ids: string[] = [];
            for (const line of text.split(/\r?\n/)) {
                for (const cell of line.split(",")) {
                    const id = parseVideoId(cell.trim());
                    if (id && !ids.includes(id)) ids.push(id);
                }
            }
            if (ids.length > 0) {
                setVideoList(ids.map(id => ({videoId: id, title: id, selected: true})));
                setListTitle(`CSV Import (${ids.length} videos)`);
            } else {
                setValidationError("No valid video IDs found in CSV");
            }
        };
        reader.readAsText(file);
        e.target.value = "";
    }, []);

    const handleSubmit = useCallback(async (e: FormEvent) => {
        e.preventDefault();

        const parsed = parseUrl(url);

        if (!parsed) {
            setValidationError("Enter a valid YouTube or Vimeo URL");
            return;
        }

        // YouTube playlist
        if (parsed.platform === "youtube" && parsed.type === "playlist") {
            setLoadingList(true);
            try {
                const data = await new Promise<{playlistTitle: string; videos: {videoId: string; title: string}[]}>((resolve, reject) => {
                    chrome.runtime.sendMessage({type: "fetch-playlist", playlistId: parsed.playlistId}, (response: unknown) => {
                        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
                        const res = response as {playlistTitle?: string; videos?: {videoId: string; title: string}[]; error?: string};
                        if (res?.error) { reject(new Error(res.error)); return; }
                        if (res?.playlistTitle && res?.videos) { resolve(res as {playlistTitle: string; videos: {videoId: string; title: string}[]}); return; }
                        reject(new Error("Invalid response"));
                    });
                });
                setVideoList(data.videos.map(v => ({...v, selected: true})));
                setListTitle(data.playlistTitle);
            } catch { /* fetch failed — list simply won't appear */ }
            setLoadingList(false);
            return;
        }

        // YouTube channel
        if (parsed.platform === "youtube" && parsed.type === "channel") {
            setLoadingList(true);
            try {
                const data = await new Promise<{channelTitle: string; videos: {videoId: string; title: string}[]}>((resolve, reject) => {
                    chrome.runtime.sendMessage({type: "fetch-channel", identifier: parsed.handle}, (response: unknown) => {
                        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
                        const res = response as {channelTitle?: string; videos?: {videoId: string; title: string}[]; error?: string};
                        if (res?.error) { reject(new Error(res.error)); return; }
                        if (res?.channelTitle && res?.videos) { resolve(res as {channelTitle: string; videos: {videoId: string; title: string}[]}); return; }
                        reject(new Error("Invalid response"));
                    });
                });
                setVideoList(data.videos.map(v => ({...v, selected: true})));
                setListTitle(data.channelTitle);
            } catch { /* fetch failed — list simply won't appear */ }
            setLoadingList(false);
            return;
        }

        // Video (YouTube or Vimeo)
        setValidationError("");
        onSubmit(parsed.videoId, parsed.platform);
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
                    YouTube & Vimeo Transcript Extractor
                </h1>
                <p className="mb-8 text-center text-lg text-slate-600 dark:text-slate-400">
                    Extract, search, and export video transcripts. Free. No signup.
                </p>

                <form onSubmit={(e) => void handleSubmit(e)} className="mb-8 w-full">
                    <div className="flex gap-2">
                        <input
                            ref={inputRef}
                            type="text"
                            value={url}
                            onChange={(e) => handleChange(e.target.value)}
                            placeholder="Paste a YouTube or Vimeo URL..."
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
                    <div className="mt-2 flex items-center justify-center">
                        <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleCsvUpload} className="hidden" />
                        <button type="button" onClick={() => fileInputRef.current?.click()}
                            className="text-xs text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400">
                            or upload a CSV of video URLs
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
                                 description="Paste any YouTube or Vimeo URL and get the full transcript in seconds."/>
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
                        placeholder="Paste a YouTube or Vimeo URL..."
                        disabled={isLoading || loadingList}
                        aria-label="YouTube URL"
                        aria-invalid={validationError.length > 0}
                        className={`min-h-[44px] flex-1 rounded-lg border-2 bg-white px-4 py-2 text-sm shadow-xs transition-colors placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 ${
                            validationError ? "border-red-400 dark:border-red-500" : "border-slate-200 dark:border-slate-600"
                        }`}
                    />
                    <button type="button" onClick={() => fileInputRef.current?.click()}
                        title="Upload CSV"
                        className="min-h-[44px] rounded-lg border-2 border-slate-200 bg-white px-2.5 text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                        </svg>
                    </button>
                    <button
                        type="submit"
                        disabled={isLoading || loadingList || url.length === 0}
                        className="min-h-[44px] whitespace-nowrap rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600 dark:focus:ring-offset-slate-900"
                    >
                        {loadingList ? "Loading..." : isLoading ? "Loading..." : "Get Transcript"}
                    </button>
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleCsvUpload} className="hidden" />
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
