import {lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {ApiError, NoteEntry, Platform, SavedTranscript, Segment, TranscriptResponse} from "../types/transcript";
import {UrlInput} from "../components/UrlInput";
import {TranscriptView, countTranscriptWords, transcriptDurationSeconds} from "../components/TranscriptView";
import {formatTimestamp} from "../lib/formatTime";
import {ExportBar} from "../components/ExportBar";
import {ErrorMessage} from "../components/ErrorMessage";
import {LoadingSpinner} from "../components/LoadingSpinner";
import {TagEditor} from "../components/TagEditor";
import {addToHistory} from "../lib/storage/history";
import {getSavedTranscript, saveTranscript, updateHighlights, updateNotes, updateTags} from "../lib/storage/saved";
import {BatchProcessor, type BatchState, type BatchItem} from "../lib/batch/queue";
import {BatchResultsNav} from "../components/BatchResultsNav";
import type {
    BackgroundToPanelMessage,
    DiscoveryResponse,
    TabTranscriptionResponse,
    TabTranscriptionTarget,
} from "../types/messages";
import type {
    DiscoveryDiagnostics,
    DiscoveryTarget,
    MediaPlaybackState,
} from "../types/discovery";

// ---------- lazy imports ----------

const Settings = lazy(() => import("../components/Settings").then((m) => ({default: m.Settings})));
const AiPanel = lazy(() => import("../components/AiPanel").then((m) => ({default: m.AiPanel})));
const History = lazy(() => import("../components/History").then((m) => ({default: m.History})));
const SavedList = lazy(() => import("../components/SavedList").then((m) => ({default: m.SavedList})));
const BatchProgress = lazy(() => import("../components/BatchProgress").then((m) => ({default: m.BatchProgress})));
const LegalPage = lazy(() => import("../components/LegalPage").then((m) => ({default: m.LegalPage})));

// ---------- types ----------

type AppState =
    | "idle"
    | "loading"
    | "discovering"
    | "discovery-permission"
    | "loaded"
    | "error"
    | "no-captions"
    | "capture-permission"
    | "transcribing";
type Modal = "settings" | "history" | "saved" | null;
type TranscriptionSource = "tab" | "file";

interface YTPlayer {
    seekTo: (seconds: number, allowSeekAhead: boolean) => void;
    getCurrentTime: () => number;
    getPlayerState: () => number;
}

type TranscriptData = TranscriptResponse;

// ---------- helpers ----------

// Files a drop/pick can transcribe. MIME type is authoritative when the OS
// provides one; the extension fallback covers containers that commonly
// arrive with an empty type (e.g. .mkv on macOS).
const MEDIA_EXT_RE = /\.(mp4|m4v|m4a|webm|mkv|mov|avi|mp3|wav|ogg|oga|opus|flac|aac|3gp|wma)$/i;

function isMediaFile(file: File): boolean {
    return (
        file.type.startsWith("video/") ||
        file.type.startsWith("audio/") ||
        MEDIA_EXT_RE.test(file.name)
    );
}

function sendRuntimeMessage(message: object): void {
    chrome.runtime.sendMessage(message, () => {
        void chrome.runtime.lastError;
    });
}

// ---------- header icons ----------

function GearIcon() {
    return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7 7 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a7 7 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a7 7 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a7 7 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
    );
}

function ClockIcon() {
    return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
    );
}

function BookmarkIcon({filled}: { filled: boolean }) {
    return filled ? (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path fillRule="evenodd"
                  d="M6.32 2.577a49.255 49.255 0 0111.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 01-1.085.67L12 18.089l-7.165 3.583A.75.75 0 013.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93z"
                  clipRule="evenodd"/>
        </svg>
    ) : (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
                  d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"/>
        </svg>
    );
}

function FolderIcon() {
    return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
                  d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"/>
        </svg>
    );
}

// ---------- transcript header ----------

function TranscriptHeader({transcript}: { transcript: TranscriptData }) {
    const duration = transcriptDurationSeconds(transcript.segments);
    const wordCount = countTranscriptWords(transcript.segments);
    return (
        <div className="mb-3">
            <h2 className="font-serif text-[19px] leading-[1.2] tracking-[-0.01em] text-slate-900 dark:text-slate-50">
                {transcript.title}
            </h2>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500 dark:text-slate-500">
                <span className="tabular-nums">{formatTimestamp(duration)}</span>
                <span className="mx-1.5 text-slate-400 dark:text-slate-700">·</span>
                <span className="tabular-nums">{wordCount.toLocaleString()}w</span>
                <span className="mx-1.5 text-slate-400 dark:text-slate-700">·</span>
                <span>{transcript.language}</span>
                {transcript.isAutoGenerated && (
                    <>
                        <span className="mx-1.5 text-slate-400 dark:text-slate-700">·</span>
                        <span className="text-slate-400 dark:text-slate-600">asr</span>
                    </>
                )}
            </p>
        </div>
    );
}

// ---------- main app ----------

export function App() {
    const [state, setState] = useState<AppState>("idle");
    const [transcript, setTranscript] = useState<TranscriptData | null>(null);
    const [error, setError] = useState<ApiError | null>(null);
    const [cleanFillers, setCleanFillers] = useState(false);
    const [modal, setModal] = useState<Modal>(null);
    const [isSaved, setIsSaved] = useState(false);
    const [tags, setTags] = useState<string[]>([]);
    const [selectedLang, setSelectedLang] = useState<string | null>(null);
    const [highlights, setHighlights] = useState<number[]>([]);
    const [notes, setNotes] = useState<NoteEntry[]>([]);
    const [batchState, setBatchState] = useState<BatchState | null>(null);
    const [batchViewMode, setBatchViewMode] = useState<"progress" | "result">("progress");
    const [route, setRoute] = useState<string>(window.location.hash);
    const [currentTime, setCurrentTime] = useState(0);
    const [activePlatform, setActivePlatform] = useState<Platform>("youtube");
    const [discoveryTarget, setDiscoveryTarget] = useState<DiscoveryTarget | null>(null);
    const [discoveryDiagnostics, setDiscoveryDiagnostics] = useState<DiscoveryDiagnostics | null>(null);
    const [mediaPlayback, setMediaPlayback] = useState<MediaPlaybackState | null>(null);
    const [transcriptionProgress, setTranscriptionProgress] = useState(0);
    const [transcriptionSource, setTranscriptionSource] = useState<TranscriptionSource | null>(null);
    const [captureTarget, setCaptureTarget] = useState<TabTranscriptionTarget | null>(null);
    const [captureRequestPending, setCaptureRequestPending] = useState(false);
    const [isStoppingTranscription, setIsStoppingTranscription] = useState(false);
    const [pendingVideoId, setPendingVideoId] = useState<string | null>(null);
    const [pendingTitle, setPendingTitle] = useState("");
    const [pageTranscriptVideoId, setPageTranscriptVideoId] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragDepthRef = useRef(0);
    // blob: URL for the currently transcribing dropped file — revoked when
    // transcription completes, errors, or is replaced by a new drop.
    const fileBlobUrlRef = useRef<string | null>(null);
    const lastFetchRef = useRef(0);
    const batchRef = useRef<BatchProcessor | null>(null);
    const lastPlayerTimeRef = useRef(0);

    const applyTranscript = useCallback((
        incoming: TranscriptData,
        platform: Platform,
        fromPage: boolean,
    ) => {
        setTranscript(incoming);
        setState("loaded");
        setError(null);
        setActivePlatform(platform);
        setSelectedLang(incoming.tracks.find((track) => track.languageCode === incoming.language)?.id
            ?? incoming.language);
        setPendingVideoId(incoming.videoId);
        setPendingTitle(incoming.title);
        setPageTranscriptVideoId(fromPage ? incoming.videoId : null);
        const wordCount = incoming.segments.reduce(
            (sum, segment) => sum + segment.text.split(/\s+/).filter(Boolean).length,
            0,
        );
        void addToHistory({
            videoId: incoming.videoId,
            title: incoming.title,
            language: incoming.language,
            thumbnailUrl: platform === "youtube"
                ? `https://img.youtube.com/vi/${incoming.videoId}/mqdefault.jpg`
                : "",
            fetchedAt: new Date().toISOString(),
            segmentCount: incoming.segments.length,
            wordCount,
            platform,
            ...(incoming.pageUrl ? {pageUrl: incoming.pageUrl} : {}),
        });
    }, []);

    const applyDiscoveryResponse = useCallback((response: DiscoveryResponse) => {
        if (response.status === "discovering") {
            setDiscoveryTarget(response);
            setDiscoveryDiagnostics(null);
            setTranscript(null);
            setError(null);
            setState("discovering");
        } else if (response.status === "awaiting-action") {
            setDiscoveryTarget(response);
            setDiscoveryDiagnostics(null);
            setTranscript(null);
            setError(null);
            setState("discovery-permission");
        } else if (response.status === "found") {
            setDiscoveryTarget(response.target);
            setDiscoveryDiagnostics(response.diagnostics);
            applyTranscript(response.data, "web", true);
        } else if (response.status === "empty") {
            setDiscoveryTarget(response.target);
            setDiscoveryDiagnostics(response.diagnostics);
            setMediaPlayback(response.media);
            setPendingTitle(response.target.title);
            setPendingVideoId(null);
            setTranscript(null);
            setError(null);
            setState("no-captions");
        } else if (response.status === "error") {
            setError({error: "fetch_failed", message: response.error});
            setState("error");
        }
    }, [applyTranscript]);

    const applyTabTranscriptionResponse = useCallback((response: TabTranscriptionResponse) => {
        if (response.status === "started") {
            setPendingVideoId(response.videoId);
            setPendingTitle(response.title);
            setCaptureTarget(null);
            setTranscript(null);
            setError(null);
            setTranscriptionProgress(0);
            setTranscriptionSource("tab");
            setIsStoppingTranscription(false);
            setState("transcribing");
            return;
        }
        if (response.status === "awaiting-action") {
            setPendingVideoId(response.videoId);
            setPendingTitle(response.title);
            setCaptureTarget(response);
            setTranscript(null);
            setError(null);
            setTranscriptionSource("tab");
            setIsStoppingTranscription(false);
            setState("capture-permission");
            return;
        }
        if (response.status === "error") {
            setCaptureTarget(null);
            setTranscriptionSource(null);
            setError({error: "transcription_failed", message: response.error});
            setState("error");
        }
    }, []);

    // Shim YTPlayer interface using message-based currentTime
    const playerRef = useRef<YTPlayer | null>(null);
    useEffect(() => {
        playerRef.current = {
            seekTo: (seconds: number) => {
                sendRuntimeMessage({type: "seek-to", time: seconds});
            },
            getCurrentTime: () => currentTime,
            // Content script sends player-time every ~1s while playing.
            // If >1.5s since last message, video is likely paused.
            getPlayerState: () => (Date.now() - lastPlayerTimeRef.current < 1500 ? 1 : 2),
        };
    }, [currentTime]);

    useEffect(() => {
        let cancelled = false;
        chrome.runtime.sendMessage(
            {type: "get-tab-transcription-state"},
            (response: TabTranscriptionResponse | undefined) => {
                if (chrome.runtime.lastError || cancelled || !response || response.status === "idle") return;
                applyTabTranscriptionResponse(response);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [applyTabTranscriptionResponse]);

    useEffect(() => {
        let cancelled = false;
        chrome.runtime.sendMessage(
            {type: "get-discovery-state"},
            (response: DiscoveryResponse | undefined) => {
                if (chrome.runtime.lastError || cancelled || !response || response.status === "idle") return;
                applyDiscoveryResponse(response);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [applyDiscoveryResponse]);

    useEffect(() => {
        const listener = (message: { type: string; data?: TranscriptData }) => {
            if (message.type !== "intercepted-transcript" || !message.data) return;
            applyTranscript(message.data, "youtube", true);
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, [applyTranscript]);

    useEffect(() => {
        const listener = (message: BackgroundToPanelMessage) => {
            switch (message.type) {
                case "discovery-started":
                    applyDiscoveryResponse({status: "discovering", ...message});
                    break;
                case "discovery-awaiting-action":
                    applyDiscoveryResponse({status: "awaiting-action", ...message});
                    break;
                case "discovery-result":
                    setDiscoveryDiagnostics(message.diagnostics);
                    setDiscoveryTarget(message.target);
                    applyTranscript(message.data, "web", true);
                    break;
                case "discovery-empty":
                    setDiscoveryTarget(message.target);
                    setDiscoveryDiagnostics(message.diagnostics);
                    setMediaPlayback(message.media);
                    setPendingTitle(message.target.title);
                    setPendingVideoId(null);
                    setTranscript(null);
                    setError(null);
                    setState("no-captions");
                    break;
                case "discovery-error":
                    setError({error: "fetch_failed", message: message.error});
                    setState("error");
                    break;
                case "media-playback-state":
                    setMediaPlayback(message.state);
                    setCurrentTime(message.state.currentTime);
                    lastPlayerTimeRef.current = message.state.paused ? 0 : Date.now();
                    break;
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, [applyDiscoveryResponse, applyTranscript]);

    const releaseFileBlob = useCallback(() => {
        if (fileBlobUrlRef.current) {
            URL.revokeObjectURL(fileBlobUrlRef.current);
            fileBlobUrlRef.current = null;
        }
    }, []);

    // Listen for player-time and transcription messages
    useEffect(() => {
        const listener = (message: {
            type: string;
            currentTime?: number;
            progress?: number;
            segments?: Segment[];
            videoId?: string;
            title?: string;
            error?: string;
            tabId?: number;
            url?: string;
        }) => {
            switch (message.type) {
                case "player-time":
                    if (message.currentTime !== undefined) {
                        lastPlayerTimeRef.current = Date.now();
                        setCurrentTime(message.currentTime);
                    }
                    break;
                case "transcription-started":
                    if (message.videoId && message.title && message.tabId !== undefined &&
                        typeof message.url === "string") {
                        applyTabTranscriptionResponse({
                            status: "started",
                            tabId: message.tabId,
                            videoId: message.videoId,
                            title: message.title,
                            url: message.url,
                        });
                    }
                    break;
                case "transcription-awaiting-action":
                    if (message.videoId && message.title && message.tabId !== undefined &&
                        typeof message.url === "string") {
                        applyTabTranscriptionResponse({
                            status: "awaiting-action",
                            tabId: message.tabId,
                            videoId: message.videoId,
                            title: message.title,
                            url: message.url,
                        });
                    }
                    break;
                case "transcription-progress":
                    setTranscriptionProgress(message.progress ?? 0);
                    if (message.segments && message.segments.length > 0) {
                        setTranscript((prev) => prev ? {...prev, segments: message.segments!} : {
                            videoId: message.videoId ?? "",
                            title: pendingTitle,
                            language: "en",
                            isAutoGenerated: true,
                            tracks: [],
                            segments: message.segments!,
                        });
                    }
                    break;
                case "transcription-complete":
                    if (message.segments) {
                        releaseFileBlob();
                        setTranscript({
                            videoId: message.videoId ?? pendingVideoId ?? "",
                            title: message.title ?? pendingTitle,
                            language: "en",
                            isAutoGenerated: true,
                            tracks: [],
                            segments: message.segments,
                        });
                        setState("loaded");
                        setTranscriptionProgress(0);
                        setCaptureTarget(null);
                        setTranscriptionSource(null);
                        setIsStoppingTranscription(false);
                    }
                    break;
                case "transcription-error":
                    releaseFileBlob();
                    setError({error: "transcription_failed", message: message.error ?? "Transcription failed"});
                    setState("error");
                    setTranscriptionProgress(0);
                    setCaptureTarget(null);
                    setTranscriptionSource(null);
                    setIsStoppingTranscription(false);
                    break;
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, [applyTabTranscriptionResponse, pendingVideoId, pendingTitle, releaseFileBlob]);

    // Hash-based routing
    useEffect(() => {
        const handler = () => setRoute(window.location.hash);
        window.addEventListener("hashchange", handler);
        return () => window.removeEventListener("hashchange", handler);
    }, []);

    // Load saved data (highlights, notes, tags) when transcript changes
    useEffect(() => {
        if (transcript) {
            getSavedTranscript(transcript.videoId).then((saved) => {
                setIsSaved(!!saved);
                setTags(saved?.tags ?? []);
                setHighlights(saved?.highlights ?? []);
                setNotes(saved?.notes ?? []);
            });
        } else {
            setIsSaved(false);
            setTags([]);
            setHighlights([]);
            setNotes([]);
        }
    }, [transcript?.videoId]);

    const fetchTranscript = useCallback(async (videoId: string, platform: Platform = "youtube", lang?: string, translateTo?: string) => {
        const now = Date.now();
        const elapsed = now - lastFetchRef.current;
        if (elapsed < 2000) {
            await new Promise((r) => setTimeout(r, 2000 - elapsed));
        }
        lastFetchRef.current = Date.now();

        setState("loading");
        setError(null);
        setActivePlatform(platform);
        setPendingVideoId(videoId);

        try {
            const response = await chrome.runtime.sendMessage({
                type: "fetch-transcript",
                videoId,
                platform,
                ...(lang ? {lang} : {}),
                ...(translateTo ? {translateTo} : {}),
            }) as { type: string; data?: TranscriptData; error?: ApiError };

            if (response.type === "transcript-error" && response.error) {
                setError(response.error);
                setState("error");
                return;
            }

            if (response.type === "transcript-result" && response.data) {
                applyTranscript(response.data, platform, false);
            }
        } catch (fetchError) {
            setError({
                error: "fetch_failed",
                message: fetchError instanceof Error
                    ? fetchError.message
                    : "Failed to fetch transcript. Please try again.",
            });
            setState("error");
        }
    }, [applyTranscript]);

    const handleSeek = useCallback((seconds: number) => {
        sendRuntimeMessage({type: "seek-to", time: seconds});
    }, []);

    const handleSave = useCallback(async () => {
        if (!transcript) return;
        await saveTranscript({
            videoId: transcript.videoId,
            title: transcript.title,
            language: transcript.language,
            isAutoGenerated: transcript.isAutoGenerated,
            segments: transcript.segments,
            ...(transcript.pageUrl ? {pageUrl: transcript.pageUrl} : {}),
            savedAt: new Date().toISOString(),
            highlights: [],
            notes: [],
            tags: [],
        });
        setIsSaved(true);
    }, [transcript]);

    const handleLoadSaved = useCallback((saved: SavedTranscript) => {
        setTranscript({
            videoId: saved.videoId,
            title: saved.title,
            language: saved.language,
            isAutoGenerated: saved.isAutoGenerated,
            tracks: [],
            segments: saved.segments,
            ...(saved.pageUrl ? {pageUrl: saved.pageUrl} : {}),
        });
        setState("loaded");
        setIsSaved(true);
    }, []);

    const handleRetry = useCallback(() => {
        setState("idle");
        setError(null);
        setDiscoveryTarget(null);
        setDiscoveryDiagnostics(null);
        setMediaPlayback(null);
        setCaptureTarget(null);
        setTranscriptionSource(null);
        setIsStoppingTranscription(false);
    }, []);

    const handleFileTranscribe = useCallback((file: File) => {
        releaseFileBlob();
        const blobUrl = URL.createObjectURL(file);
        fileBlobUrlRef.current = blobUrl;
        const title = file.name.replace(/\.[^.]+$/, "");
        const videoId = `file-${Date.now()}`;
        setPendingVideoId(videoId);
        setPendingTitle(title);
        setTranscript(null);
        setError(null);
        setCaptureTarget(null);
        setState("transcribing");
        setTranscriptionProgress(0);
        setTranscriptionSource("file");
        setIsStoppingTranscription(false);
        chrome.runtime
            .sendMessage({type: "transcribe-file", blobUrl, videoId, title})
            .catch(() => {
                releaseFileBlob();
                setError({error: "transcription_failed", message: "Could not start file transcription."});
                setState("error");
            });
    }, [releaseFileBlob]);

    const requestTabTranscription = useCallback(async (videoId?: string, title?: string) => {
        setCaptureRequestPending(true);
        try {
            const response = await chrome.runtime.sendMessage({
                type: "start-transcription",
                ...(videoId ? {videoId} : {}),
                ...(title ? {title} : {}),
            }) as TabTranscriptionResponse;
            applyTabTranscriptionResponse(response);
        } catch (requestError) {
            applyTabTranscriptionResponse({
                status: "error",
                error: requestError instanceof Error
                    ? requestError.message
                    : "Could not start tab transcription.",
            });
        } finally {
            setCaptureRequestPending(false);
        }
    }, [applyTabTranscriptionResponse]);

    const requestCurrentTabDiscovery = useCallback(async () => {
        setCaptureRequestPending(true);
        try {
            const response = await chrome.runtime.sendMessage({
                type: "discover-current-tab",
            }) as DiscoveryResponse;
            applyDiscoveryResponse(response);
        } catch (discoveryError) {
            applyDiscoveryResponse({
                status: "error",
                error: discoveryError instanceof Error
                    ? discoveryError.message
                    : "Could not inspect the current media page.",
            });
        } finally {
            setCaptureRequestPending(false);
        }
    }, [applyDiscoveryResponse]);

    const handlePrepareUrlDiscovery = useCallback(async (url: string) => {
        const response = await chrome.runtime.sendMessage({
            type: "prepare-url-discovery",
            url,
        }) as DiscoveryResponse;
        if (response.status === "error") throw new Error(response.error);
        applyDiscoveryResponse(response);
    }, [applyDiscoveryResponse]);

    const handleCancelPendingDiscovery = useCallback(async () => {
        if (discoveryTarget) {
            const response = await chrome.runtime.sendMessage({
                type: "cancel-pending-discovery",
                tabId: discoveryTarget.tabId,
            }) as DiscoveryResponse;
            if (response.status === "error") throw new Error(response.error);
        }
        setDiscoveryTarget(null);
        setDiscoveryDiagnostics(null);
        setState("idle");
    }, [discoveryTarget]);

    const requestMediaSourceDiscovery = useCallback(async () => {
        const origins = discoveryDiagnostics?.requiredOrigins.map((origin) => `${origin}/*`) ?? [];
        if (origins.length === 0 || !discoveryTarget) return;
        const granted = await chrome.permissions.request({origins});
        if (!granted) {
            setError({
                error: "fetch_failed",
                message: "Chrome did not grant access to the media source.",
            });
            setState("error");
            return;
        }
        setCaptureRequestPending(true);
        try {
            const response = await chrome.runtime.sendMessage({
                type: "rediscover-tab",
                tabId: discoveryTarget.tabId,
            }) as DiscoveryResponse;
            applyDiscoveryResponse(response);
        } finally {
            setCaptureRequestPending(false);
        }
    }, [applyDiscoveryResponse, discoveryDiagnostics, discoveryTarget]);

    const handleCancelPendingTranscription = useCallback(async () => {
        try {
            if (captureTarget) {
                const response = await chrome.runtime.sendMessage({
                    type: "cancel-pending-transcription",
                    tabId: captureTarget.tabId,
                }) as TabTranscriptionResponse;
                if (response.status === "error") throw new Error(response.error);
            }
            setCaptureTarget(null);
            setPendingVideoId(null);
            setPendingTitle("");
            setTranscriptionSource(null);
            setState("idle");
        } catch (cancelError) {
            setError({
                error: "transcription_failed",
                message: cancelError instanceof Error
                    ? cancelError.message
                    : "Could not cancel this transcription request.",
            });
            setState("error");
        }
    }, [captureTarget]);

    const handleStopTranscription = useCallback(() => {
        if (transcriptionSource === "tab") {
            setIsStoppingTranscription(true);
        } else {
            releaseFileBlob();
            setState("idle");
            setTranscriptionProgress(0);
            setTranscriptionSource(null);
        }
        void chrome.runtime.sendMessage({type: "stop-transcription"}).catch((stopError: unknown) => {
            setError({
                error: "transcription_failed",
                message: stopError instanceof Error
                    ? stopError.message
                    : "Could not stop transcription.",
            });
            setState("error");
            setIsStoppingTranscription(false);
        });
    }, [releaseFileBlob, transcriptionSource]);

    const handleLanguageChange = useCallback((trackValue: string) => {
        if (!transcript) return;
        setSelectedLang(trackValue);
        const track = transcript.tracks.find((candidate) =>
            (candidate.id ?? candidate.languageCode) === trackValue
        );
        if (
            track?.id
            && (transcript.source === "page-track" || transcript.source === "network-resource")
        ) {
            void chrome.runtime.sendMessage({
                type: "select-discovered-track",
                videoId: transcript.videoId,
                trackId: track.id,
            }).then((response: {type?: string; data?: TranscriptData}) => {
                if (response.type === "transcript-result" && response.data) {
                    applyTranscript(response.data, "web", true);
                }
            });
            return;
        }
        void fetchTranscript(transcript.videoId, activePlatform, track?.languageCode ?? trackValue);
    }, [activePlatform, applyTranscript, fetchTranscript, transcript]);

    const handleTagsChange = useCallback((newTags: string[]) => {
        if (!transcript) return;
        setTags(newTags);
        void updateTags(transcript.videoId, newTags);
    }, [transcript]);

    const handleHighlightToggle = useCallback((segmentIndex: number) => {
        if (!transcript || !isSaved) return;
        setHighlights(prev => {
            const next = prev.includes(segmentIndex)
                ? prev.filter(i => i !== segmentIndex)
                : [...prev, segmentIndex];
            void updateHighlights(transcript.videoId, next);
            return next;
        });
    }, [transcript, isSaved]);

    const handleNoteUpdate = useCallback((segmentIndex: number, text: string) => {
        if (!transcript || !isSaved) return;
        setNotes(prev => {
            const filtered = prev.filter(n => n.segmentIndex !== segmentIndex);
            const next = text.trim()
                ? [...filtered, {segmentIndex, text: text.trim(), createdAt: new Date().toISOString()}]
                : filtered;
            void updateNotes(transcript.videoId, next);
            return next;
        });
    }, [transcript, isSaved]);

    // ---------- batch handlers ----------

    const handleSubmitBatch = useCallback(async (videoIds: string[]) => {
        const granted = await chrome.permissions.request({
            origins: ["https://*.youtube.com/*"],
        });
        if (!granted) {
            setError({
                error: "fetch_failed",
                message: "Page access is required to process this bulk source.",
            });
            setState("error");
            return;
        }
        const processor = new BatchProcessor();
        batchRef.current = processor;
        processor.onProgress = (s) => setBatchState(s);
        processor.start(videoIds);
        setBatchViewMode("progress");
    }, []);

    const handleBatchViewResult = useCallback((videoId: string) => {
        const item = batchState?.items.find(i => i.videoId === videoId);
        if (item?.result) {
            setTranscript({
                videoId: item.result.videoId,
                title: item.result.title,
                language: item.result.language,
                isAutoGenerated: item.result.isAutoGenerated,
                tracks: item.result.tracks,
                segments: item.result.segments,
            });
            setState("loaded");
            setBatchViewMode("result");
        }
    }, [batchState]);

    const handleBackToBatch = useCallback(() => {
        setBatchViewMode("progress");
        setState("idle");
        setTranscript(null);
    }, []);

    const handleBatchCancel = useCallback(() => {
        batchRef.current?.cancel();
    }, []);

    const handleBatchRetry = useCallback(() => {
        batchRef.current?.retryFailed();
    }, []);

    const handleBatchExport = useCallback((format: string, mode: "separate" | "merged") => {
        if (!batchState || !batchRef.current) return;
        if (mode === "merged") batchRef.current.exportMerged(batchState.items, format);
        else batchRef.current.exportAsZip(batchState.items, format);
    }, [batchState]);

    const batchCompletedItems = useMemo(() => {
        if (!batchState) return [];
        return batchState.items
            .filter((i): i is BatchItem & {result: TranscriptResponse} => i.status === "success" && !!i.result)
            .map(i => ({videoId: i.videoId, title: i.title ?? i.videoId}));
    }, [batchState]);

    const iconBtnClass = "rounded-md p-1 text-slate-500 hover:bg-slate-200/40 hover:text-slate-200 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors";

    // ---------- legal page route ----------
    if (route === "#/legal") {
        return (
            <div className="min-h-screen bg-white dark:bg-slate-900">
                <header
                    className="border-b border-slate-200 bg-white/80 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/80">
                    <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2">
                        <span className="text-sm font-medium text-slate-900 dark:text-white">Transcript</span>
                    </div>
                </header>
                <Suspense fallback={null}>
                    <LegalPage onBack={() => {
                        window.location.hash = "";
                        setRoute("");
                    }}/>
                </Suspense>
            </div>
        );
    }

    // ---------- main app route ----------
    return (
        <div
            className="min-h-screen bg-white text-slate-900 dark:bg-[#0b0d10] dark:text-slate-100"
            onDragEnter={(e) => {
                if (!e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                dragDepthRef.current += 1;
                setIsDragging(true);
            }}
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDragLeave={() => {
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                if (dragDepthRef.current === 0) setIsDragging(false);
            }}
            onDrop={(e) => {
                e.preventDefault();
                dragDepthRef.current = 0;
                setIsDragging(false);
                const file = e.dataTransfer.files[0];
                if (file && isMediaFile(file)) handleFileTranscribe(file);
            }}
        >
            {/* Drop-anywhere overlay */}
            {isDragging && (
                <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-500 bg-blue-500/10">
                    <div className="rounded-xl bg-white px-5 py-4 text-center shadow-lg dark:bg-slate-800">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">Drop to transcribe</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            Any video or audio file — transcribed on this device, never uploaded
                        </p>
                    </div>
                </div>
            )}
            {/* Header — single row, mostly negative space */}
            <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur-md dark:border-slate-800/60 dark:bg-[#0b0d10]/85">
                <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-1.5">
                    {/* Word-mark — the wordmark IS the only branding here */}
                    <span className="font-serif text-[15px] italic leading-none tracking-tight text-slate-900 dark:text-slate-100">v·t</span>
                    {pageTranscriptVideoId && transcript?.videoId === pageTranscriptVideoId && state === "loaded" && (
                        <span
                            title="Read from this page's native timed-text data"
                            className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-amber-700 dark:border-amber-300/20 dark:text-amber-300"
                        >
                            <span className="h-1 w-1 rounded-full bg-amber-500 dark:bg-amber-400" />
                            Native
                        </span>
                    )}
                    <div className="ml-auto flex items-center gap-0.5">
                        {state === "loaded" && (
                            <button
                                onClick={handleSave}
                                title={isSaved ? "Saved" : "Save transcript"}
                                className={iconBtnClass}
                                disabled={isSaved}
                            >
                                <BookmarkIcon filled={isSaved}/>
                            </button>
                        )}
                        <button onClick={() => setModal("history")} title="History" className={iconBtnClass}>
                            <ClockIcon/>
                        </button>
                        <button onClick={() => setModal("saved")} title="Saved transcripts" className={iconBtnClass}>
                            <FolderIcon/>
                        </button>
                        <button onClick={() => setModal("settings")} title="Settings" className={iconBtnClass}>
                            <GearIcon/>
                        </button>
                    </div>
                </div>
            </header>

            {/* Main content */}
            <div className="mx-auto max-w-5xl px-3 pt-3 pb-6">
                <UrlInput
                    onSubmit={(id, platform) => void fetchTranscript(id, platform)}
                    onSubmitUrl={handlePrepareUrlDiscovery}
                    onSubmitBatch={handleSubmitBatch}
                    onDiscoverCurrentTab={() => void requestCurrentTabDiscovery()}
                    onSubmitFile={handleFileTranscribe}
                    isLoading={
                        state === "loading" ||
                        state === "discovering" ||
                        state === "discovery-permission" ||
                        state === "transcribing" ||
                        state === "capture-permission" ||
                        captureRequestPending
                    }
                    compact={state !== "idle"}
                />

                {batchState && batchViewMode === "result" && batchCompletedItems.length > 0 && (
                    <BatchResultsNav
                        items={batchCompletedItems}
                        activeVideoId={transcript?.videoId ?? null}
                        onSelect={handleBatchViewResult}
                        onBackToBatch={handleBackToBatch}
                    />
                )}

                {batchState && batchViewMode === "progress" && (
                    <Suspense fallback={<div className="h-32 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"/>}>
                        <BatchProgress
                            batchState={batchState}
                            onRetry={handleBatchRetry}
                            onCancel={handleBatchCancel}
                            onViewResult={handleBatchViewResult}
                            onExport={handleBatchExport}
                        />
                    </Suspense>
                )}

                {state === "loading" && <LoadingSpinner/>}

                {state === "discovering" && (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-600 dark:text-blue-400">
                            Inspecting page
                        </p>
                        <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                            Looking for native timed text
                        </h3>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                            Checking runtime cues, HTML tracks, subtitle resources, and streaming manifests.
                            Playback can stay paused.
                        </p>
                    </div>
                )}

                {state === "discovery-permission" && discoveryTarget && (
                    <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-400/20 dark:bg-blue-400/[0.06]">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-700 dark:text-blue-300">
                            One page-access click
                        </p>
                        <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                            Ready to inspect the opened media page
                        </h3>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                            Click the Video Transcript toolbar icon on that tab. Chrome grants temporary
                            access to discover its subtitle data; the video does not need to be playing.
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                void handleCancelPendingDiscovery().catch((cancelError: unknown) => {
                                    setError({
                                        error: "fetch_failed",
                                        message: cancelError instanceof Error
                                            ? cancelError.message
                                            : "Could not cancel page discovery.",
                                    });
                                    setState("error");
                                });
                            }}
                            className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                            Cancel
                        </button>
                    </div>
                )}

                {state === "capture-permission" && captureTarget && (
                    <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-400/20 dark:bg-blue-400/[0.06]">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-700 dark:text-blue-300">
                            One permission click
                        </p>
                        <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                            Ready on the video tab
                        </h3>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                            Start playing the video, then click the Video Transcript toolbar icon once.
                            Chrome grants tab-audio access from that click and transcription starts automatically.
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => void handleCancelPendingTranscription()}
                                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {state === "no-captions" && (
                    <div className="mt-8 text-center">
                        <h3 className="mb-1 text-base font-medium text-slate-900 dark:text-white">
                            No readable subtitle track
                        </h3>
                        <p className="mx-auto mb-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                            The page did not expose runtime cues or a supported timed-text resource.
                            Native discovery works while paused; live audio transcription does not.
                        </p>
                        {discoveryDiagnostics && (
                            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400 dark:text-slate-600">
                                {discoveryDiagnostics.candidateCount} candidates inspected
                                {discoveryDiagnostics.hasUnsupportedTimedText ? " · embedded/binary captions detected" : ""}
                            </p>
                        )}
                        <div className="flex flex-wrap items-center justify-center gap-2">
                            {(discoveryDiagnostics?.requiredOrigins.length ?? 0) > 0 && (
                                <button
                                    onClick={() => {
                                        void requestMediaSourceDiscovery().catch((permissionError: unknown) => {
                                            setError({
                                                error: "fetch_failed",
                                                message: permissionError instanceof Error
                                                    ? permissionError.message
                                                    : "Could not inspect the media source.",
                                            });
                                            setState("error");
                                        });
                                    }}
                                    className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                                >
                                    Inspect media sources
                                </button>
                            )}
                            <button
                                onClick={() => void requestTabTranscription(
                                    pendingVideoId ?? undefined,
                                    pendingTitle || undefined,
                                )}
                                className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                Transcribe live audio
                            </button>
                        </div>
                        <p className="mt-2 text-xs text-slate-400 dark:text-slate-600">
                            Start or resume playback first. Audio stays on this device.
                        </p>
                    </div>
                )}

                {state === "transcribing" && (
                    <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
                        <div className="mb-3 flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">
                                {isStoppingTranscription
                                    ? "Finishing transcript…"
                                    : transcriptionSource === "tab"
                                        ? mediaPlayback?.ended
                                            ? "Playback ended — finishing transcript…"
                                            : mediaPlayback?.paused
                                                ? "Playback paused — resume the video"
                                                : mediaPlayback?.muted
                                                    ? "Video is muted — unmute to continue"
                                                    : "Transcribing live audio"
                                        : `Transcribing… ${transcriptionProgress}%`}
                            </span>
                            <button
                                onClick={handleStopTranscription}
                                disabled={isStoppingTranscription}
                                className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
                            >
                                {isStoppingTranscription ? "Finishing…" : "Stop"}
                            </button>
                        </div>
                        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                            <div
                                className="h-full rounded-full bg-blue-500 transition-all"
                                style={{width: `${Math.max(
                                    transcriptionSource === "tab" && mediaPlayback?.duration
                                        ? Math.min(99, (mediaPlayback.currentTime / mediaPlayback.duration) * 100)
                                        : transcriptionProgress,
                                    2,
                                )}%`}}
                            />
                        </div>
                        {transcript && transcript.segments.length > 0 && (
                            <>
                                <TranscriptHeader transcript={transcript}/>
                                <TranscriptView
                                    segments={transcript.segments}
                                    language={transcript.language}
                                    playerRef={playerRef}
                                    cleanFillers={cleanFillers}
                                    onCleanFillersChange={setCleanFillers}
                                />
                            </>
                        )}
                    </div>
                )}

                {state === "error" && error && (
                    <ErrorMessage
                        error={error.error}
                        message={error.message}
                        onRetry={handleRetry}
                        onOpenOriginal={discoveryTarget ? () => {
                            void chrome.tabs.update(discoveryTarget.tabId, {active: true});
                        } : undefined}
                    />
                )}

                {state === "loaded" && transcript && (
                    <div className="space-y-4">
                        {/* Tags */}
                        {isSaved && (
                            <div className="max-w-md">
                                <TagEditor tags={tags} onTagsChange={handleTagsChange} />
                            </div>
                        )}

                        {/* Language selector */}
                        {transcript.tracks.length > 1 && (
                            <div className="max-w-xs">
                                <label
                                    htmlFor="transcript-track"
                                    className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
                                >
                                    Language
                                </label>
                                <select
                                    id="transcript-track"
                                    value={selectedLang ?? transcript.tracks[0]?.id ?? transcript.language}
                                    onChange={(e) => handleLanguageChange(e.target.value)}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                                >
                                    {transcript.tracks.map((track) => (
                                        <option
                                            key={track.id ?? track.languageCode}
                                            value={track.id ?? track.languageCode}
                                        >
                                            {track.name} {track.kind === "asr" ? "(auto)" : ""}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Title + meta */}
                        <TranscriptHeader transcript={transcript}/>

                        {/* AI Panel first — promoted above the transcript so users don't have to scroll past
                            the whole reading view to reach the analyze tools. */}
                        <Suspense
                            fallback={<div className="h-32 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"/>}>
                            <AiPanel transcript={transcript as TranscriptResponse} onSeek={handleSeek}/>
                        </Suspense>

                        {/* Transcript reference */}
                        <TranscriptView
                            segments={transcript.segments}
                            language={transcript.language}
                            playerRef={playerRef}
                            cleanFillers={cleanFillers}
                            onCleanFillersChange={setCleanFillers}
                            highlights={highlights}
                            notes={notes}
                            onHighlightToggle={isSaved ? handleHighlightToggle : undefined}
                            onNoteUpdate={isSaved ? handleNoteUpdate : undefined}
                        />

                        {/* Export bar */}
                        <ExportBar
                            segments={transcript.segments}
                            title={transcript.title}
                            language={transcript.language}
                            videoId={transcript.videoId}
                            sourceUrl={transcript.pageUrl}
                            isAutoGenerated={transcript.isAutoGenerated}
                            showTimestamps={true}
                            cleanFillers={cleanFillers}
                            chapters={transcript.chapters}
                            highlights={highlights}
                        />
                    </div>
                )}
            </div>

            {/* Modals */}
            <Suspense fallback={null}>
                <Settings
                    isOpen={modal === "settings"}
                    onClose={() => setModal(null)}
                />
                <History
                    isOpen={modal === "history"}
                    onClose={() => setModal(null)}
                    onSelectEntry={(entry) => {
                        setModal(null);
                        if (entry.pageUrl) {
                            void handlePrepareUrlDiscovery(entry.pageUrl);
                        } else {
                            void chrome.permissions.request({
                                origins: ["https://*.youtube.com/*"],
                            }).then((granted) => {
                                if (granted) {
                                    void fetchTranscript(entry.videoId, entry.platform ?? "youtube");
                                }
                            });
                        }
                    }}
                />
                <SavedList
                    isOpen={modal === "saved"}
                    onClose={() => setModal(null)}
                    onLoadSaved={handleLoadSaved}
                />
            </Suspense>

            {/* Footer */}
            <footer className="mt-8 border-t border-slate-200 dark:border-slate-700">
                <div className="mx-auto max-w-5xl px-4 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                    <a href="#/legal" className="hover:text-slate-700 dark:hover:text-slate-300 underline">
                        Legal & Privacy
                    </a>
                </div>
            </footer>
        </div>
    );
}
