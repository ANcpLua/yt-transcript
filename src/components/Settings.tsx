import {useCallback, useEffect, useRef, useState} from "react";
import type {Preferences} from "../types/transcript";
import {getPreferences, savePreferences} from "../lib/storage/preferences";
import {clearAllData, exportAllData} from "../lib/storage/saved";
import {clearHistory} from "../lib/storage/history";
import {isChromeAiAvailable, isChromeAiPromptAvailable} from "../lib/ai/chrome-ai";

// ---------- types & constants ----------

type WhisperState =
    | "unknown"          // still probing on open
    | "not-downloaded"   // weights absent, permission may or may not be granted
    | "needs-permission" // user clicked Download but HF host permission denied
    | "downloading"
    | "ready"
    | "error";

type ProviderStatus = "ready" | "saved" | "unreachable" | "needs-config" | "checking";
type TabId = "ai" | "audio" | "data";

// Match the patterns in manifest.json's optional_host_permissions verbatim
// so chrome.permissions.contains / .request resolve against the same key.
// Anything narrower (e.g. "https://...") risks a false negative on
// .contains() when the user already granted the broader "*://..." pattern.
const HF_ORIGINS = [
    "*://huggingface.co/*",
    "*://*.huggingface.co/*",
    "*://cdn-lfs.huggingface.co/*",
    "*://cdn-lfs.hf.co/*",
];

const DEFAULT_PREFS: Preferences = {
    aiProvider: "chrome-ai",
    whisperModel: "tiny",
};

interface SettingsProps {
    isOpen: boolean;
    onClose: () => void;
    onPreferencesChange: (prefs: Preferences) => void;
}

export function formatQuota(kb: number): string {
    if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${kb.toFixed(1)} KB`;
}

// ---------- shared bits ----------

function StatusDot({status}: {status: ProviderStatus}) {
    const cls =
        status === "ready" ? "bg-emerald-500"
        : status === "saved" ? "bg-amber-400"
        : status === "unreachable" ? "bg-red-500"
        : status === "checking" ? "bg-slate-300 dark:bg-slate-600 animate-pulse"
        : "bg-slate-300 dark:bg-slate-700";
    return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} aria-hidden="true" />;
}

function CloseIcon() {
    return (
        <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
    );
}

// ---------- main component ----------

export function Settings({isOpen, onClose, onPreferencesChange}: SettingsProps) {
    const [tab, setTab] = useState<TabId>("ai");
    const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
    const [storageEstimate, setStorageEstimate] = useState<{usage: number; quota: number} | null>(null);

    // Whisper state
    const [whisperState, setWhisperState] = useState<WhisperState>("unknown");
    const [whisperProgress, setWhisperProgress] = useState(0);
    const [whisperError, setWhisperError] = useState<string | null>(null);
    const [hfPermissionGranted, setHfPermissionGranted] = useState<boolean | null>(null);

    // Chrome AI details
    const [chromeAiStatus, setChromeAiStatus] = useState<"checking" | "available" | "summarizer-only" | "unavailable">("checking");
    const [chromeAiProviderStatus, setChromeAiProviderStatus] = useState<ProviderStatus>("checking");

    const hasWebGpu = typeof (navigator as Navigator & { gpu?: unknown }).gpu !== "undefined";

    // Mirror whisperState into a ref so the runtime listener (registered
    // once per open() cycle) can branch on the latest value without forcing
    // a fresh subscription every time the state ticks.
    const whisperStateRef = useRef<WhisperState>("unknown");
    useEffect(() => { whisperStateRef.current = whisperState; }, [whisperState]);

    // ----- preferences -----
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        void (async () => {
            const p = await getPreferences();
            if (cancelled) return;
            setPrefs(p);
        })();
        return () => { cancelled = true; };
    }, [isOpen]);

    // ----- Chrome AI probe -----
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setChromeAiProviderStatus("checking");
        void (async () => {
            const promptOk = await isChromeAiPromptAvailable();
            if (cancelled) return;
            if (promptOk) {
                setChromeAiStatus("available");
                setChromeAiProviderStatus("ready");
                return;
            }
            const summarizerOk = await isChromeAiAvailable();
            if (cancelled) return;
            setChromeAiStatus(summarizerOk ? "summarizer-only" : "unavailable");
            setChromeAiProviderStatus(summarizerOk ? "saved" : "unreachable");
        })();
        return () => { cancelled = true; };
    }, [isOpen]);

    // ----- Whisper status + HF permission -----
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        // Probe HF host permission separately from cache state — the user
        // may have a cached model from before we moved HF to optional, or
        // the reverse: permission granted but cache cleared.
        void chrome.permissions.contains({origins: HF_ORIGINS}).then((granted) => {
            if (!cancelled) setHfPermissionGranted(granted);
        }).catch(() => {
            if (!cancelled) setHfPermissionGranted(false);
        });

        // Scope the readiness check to the currently selected model — a
        // user with Tiny cached but Base selected should see
        // "Not downloaded", not a stale "Ready" that hides the upcoming
        // on-demand download.
        const askingForModel = prefs.whisperModel;
        chrome.runtime.sendMessage(
            {type: "check-whisper-status", model: askingForModel},
            (response: {downloaded?: boolean; model?: "tiny" | "base"} | undefined) => {
                if (cancelled) return;
                const matchesCurrent = response?.model === askingForModel;
                setWhisperState(response?.downloaded && matchesCurrent ? "ready" : "not-downloaded");
            },
        );

        const listener = (msg: {type: string; progress?: number}) => {
            if (msg.type === "download-whisper-progress") {
                if (msg.progress === 100) {
                    setWhisperState("ready");
                    setWhisperProgress(100);
                    setWhisperError(null);
                } else if (msg.progress === -1) {
                    setWhisperState("error");
                    setWhisperProgress(0);
                } else {
                    setWhisperState("downloading");
                    setWhisperProgress(msg.progress ?? 0);
                    setWhisperError(null);
                }
            } else if (msg.type === "transcription-error" && whisperStateRef.current === "downloading") {
                // Download failures arrive as transcription-error with a "Model download failed: " prefix.
                const errMsg = (msg as {error?: string}).error ?? "Download failed";
                if (errMsg.startsWith("Model download failed")) {
                    setWhisperState("error");
                    setWhisperError(errMsg.replace(/^Model download failed:\s*/, ""));
                }
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => {
            cancelled = true;
            chrome.runtime.onMessage.removeListener(listener);
        };
    }, [isOpen, prefs.whisperModel]);

    // ----- Storage estimate -----
    useEffect(() => {
        if (!isOpen) return;
        if (navigator.storage?.estimate) {
            navigator.storage.estimate().then((est) => {
                setStorageEstimate({
                    usage: est.usage ?? 0,
                    quota: est.quota ?? 0,
                });
            }).catch(() => {});
        }
    }, [isOpen]);

    const updatePref = useCallback(
        <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
            const next = {...prefs, [key]: value};
            setPrefs(next);
            void savePreferences(next);
            onPreferencesChange(next);
        },
        [prefs, onPreferencesChange],
    );

    // ----- handlers -----

    const handleExport = async () => {
        const data = await exportAllData();
        const blob = new Blob([data], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "yt-transcript-backup.json";
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleClearAll = async () => {
        if (!confirm("Delete all saved transcripts and history? This cannot be undone.")) return;
        await clearAllData();
        await clearHistory();
        setStorageEstimate(null);
    };

    // Whisper download — must run inside a user-gesture handler so the
    // chrome.permissions.request browser prompt is allowed to open.
    const handleDownloadWhisper = async () => {
        setWhisperError(null);
        try {
            const granted = await chrome.permissions.request({origins: HF_ORIGINS});
            setHfPermissionGranted(granted);
            if (!granted) {
                setWhisperState("needs-permission");
                return;
            }
        } catch (err) {
            // Some environments throw instead of returning false; treat the
            // same way and keep the original error visible.
            setHfPermissionGranted(false);
            setWhisperState("needs-permission");
            setWhisperError(err instanceof Error ? err.message : String(err));
            return;
        }
        setWhisperState("downloading");
        setWhisperProgress(0);
        chrome.runtime.sendMessage({type: "download-whisper", model: prefs.whisperModel});
    };

    const handleDeleteWhisper = () => {
        chrome.runtime.sendMessage({type: "delete-whisper"});
        setWhisperState("not-downloaded");
        setWhisperProgress(0);
    };

    // Reset visible progress + state when the model selection changes —
    // the cached pipeline (if any) is now for the wrong model, so the
    // user is effectively back to "not downloaded" until they click again.
    // The per-model readiness check (effect deps on prefs.whisperModel)
    // will flip us back to "ready" if the new model is already cached.
    const handleWhisperModelChange = (model: "tiny" | "base") => {
        updatePref("whisperModel", model);
        setWhisperProgress(0);
        setWhisperError(null);
        setWhisperState(hfPermissionGranted === false ? "needs-permission" : "not-downloaded");
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-sm py-8"
            onClick={onClose}
        >
            <div
                className="mx-3 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 dark:ring-1 dark:ring-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">Settings</h2>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="-m-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                        <CloseIcon/>
                    </button>
                </header>

                {/* Tab bar — div, not nav, because ARIA tabs pattern uses
                    role="tablist" on a generic container. */}
                <div className="flex border-b border-slate-100 dark:border-slate-800" role="tablist">
                    {([
                        {id: "ai" as TabId, label: "AI"},
                        {id: "audio" as TabId, label: "Audio"},
                        {id: "data" as TabId, label: "Data"},
                    ]).map((t) => {
                        const active = tab === t.id;
                        return (
                            <button
                                key={t.id}
                                role="tab"
                                aria-selected={active}
                                onClick={() => setTab(t.id)}
                                className={`relative flex-1 px-3 py-2.5 text-sm font-medium transition-colors ${
                                    active
                                        ? "text-slate-900 dark:text-white"
                                        : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                }`}
                            >
                                {t.label}
                                {active && (
                                    <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-slate-900 dark:bg-white"/>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Tab content */}
                <div className="max-h-[68vh] overflow-y-auto px-5 py-4">
                    {tab === "ai" && (
                        <section className="space-y-4">
                            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
                                <span className="text-xs text-slate-500 dark:text-slate-400">AI engine</span>
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                                    <StatusDot status={chromeAiProviderStatus}/>
                                    Chrome AI
                                    {chromeAiProviderStatus === "ready" && " — ready"}
                                    {chromeAiProviderStatus === "saved" && " — summary only"}
                                    {chromeAiProviderStatus === "unreachable" && " — unavailable"}
                                    {chromeAiProviderStatus === "checking" && " — checking"}
                                </span>
                            </div>

                            <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40">
                                <p className="text-sm text-slate-700 dark:text-slate-200">
                                    Chrome built-in AI is the only AI engine for this extension.
                                </p>
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    {chromeAiStatus === "checking" && "Checking this Chrome profile…"}
                                    {chromeAiStatus === "available" && "Ready for Summary, Key points, Q&A, and Chat."}
                                    {chromeAiStatus === "summarizer-only" && "Ready for Summary. Chat and Q&A need Chrome's Prompt API."}
                                    {chromeAiStatus === "unavailable" && "Unavailable in this Chrome profile."}
                                </p>
                            </div>
                        </section>
                    )}

                    {tab === "audio" && (
                        <section className="space-y-4">
                            <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40">
                                <div className="mb-3 flex items-center justify-between">
                                    <span className="text-sm font-medium text-slate-900 dark:text-white">Whisper model</span>
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                        {hasWebGpu ? "WebGPU" : "WASM"}
                                    </span>
                                </div>

                                {/* Model selector */}
                                <div className="mb-3 grid grid-cols-2 gap-2">
                                    {([
                                        {id: "tiny" as const, size: "40 MB", note: "Fastest"},
                                        {id: "base" as const, size: "150 MB", note: "More accurate"},
                                    ]).map((m) => {
                                        const selected = prefs.whisperModel === m.id;
                                        return (
                                            <button
                                                key={m.id}
                                                onClick={() => handleWhisperModelChange(m.id)}
                                                className={`rounded-md border px-2.5 py-2 text-left transition-colors ${
                                                    selected
                                                        ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                                                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                                }`}
                                            >
                                                <span className="block text-sm font-medium capitalize">{m.id}</span>
                                                <span className={`block text-[11px] ${selected ? "opacity-80" : "text-slate-500 dark:text-slate-400"}`}>
                                                    {m.size} · {m.note}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* State + action */}
                                <div className="space-y-2">
                                    {whisperState === "unknown" && (
                                        <p className="text-xs text-slate-500 dark:text-slate-400">Checking…</p>
                                    )}

                                    {whisperState === "not-downloaded" && (
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                                {hfPermissionGranted ? "Not downloaded" : "Not downloaded · permission required"}
                                            </span>
                                            <button
                                                onClick={() => void handleDownloadWhisper()}
                                                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                                            >
                                                Download
                                            </button>
                                        </div>
                                    )}

                                    {whisperState === "needs-permission" && (
                                        <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                                            <p className="font-medium">Permission denied</p>
                                            <p className="mt-1">
                                                Whisper weights are downloaded from huggingface.co. We need your permission to fetch them.
                                                {whisperError && <span className="mt-1 block opacity-80">{whisperError}</span>}
                                            </p>
                                            <button
                                                onClick={() => void handleDownloadWhisper()}
                                                className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
                                            >
                                                Try again
                                            </button>
                                        </div>
                                    )}

                                    {whisperState === "downloading" && (
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                                    Downloading… {whisperProgress}%
                                                </span>
                                                <span className="text-[10px] text-slate-400 dark:text-slate-500">streams from huggingface.co</span>
                                            </div>
                                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                                <div
                                                    className="h-full rounded-full bg-slate-900 transition-all dark:bg-white"
                                                    style={{width: `${Math.max(whisperProgress, 2)}%`}}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {whisperState === "ready" && (
                                        <div className="flex items-center justify-between">
                                            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                                                <StatusDot status="ready"/>
                                                Ready
                                            </span>
                                            <button
                                                onClick={handleDeleteWhisper}
                                                className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                            >
                                                Delete weights
                                            </button>
                                        </div>
                                    )}

                                    {whisperState === "error" && (
                                        <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                                            <p className="font-medium">Download failed</p>
                                            {whisperError && <p className="mt-1 opacity-90">{whisperError}</p>}
                                            <button
                                                onClick={() => void handleDownloadWhisper()}
                                                className="mt-2 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                                            >
                                                Retry
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                                    Used when a video has no captions. Runs entirely in your browser; first download caches in CacheStorage.
                                </p>
                            </div>
                        </section>
                    )}

                    {tab === "data" && (
                        <section className="space-y-5">
                            <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40">
                                <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Storage</h3>
                                {storageEstimate && storageEstimate.quota > 0 && (() => {
                                    const usageKB = storageEstimate.usage / 1024;
                                    const quotaKB = storageEstimate.quota / 1024;
                                    const pct = quotaKB > 0 ? Math.min((usageKB / quotaKB) * 100, 100) : 0;
                                    const warn = pct > 80;
                                    return (
                                        <div className="mb-3">
                                            <div className="mb-1.5 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                                                <span>{formatQuota(usageKB)} used</span>
                                                <span>of {formatQuota(quotaKB)}</span>
                                            </div>
                                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                                <div
                                                    className={`h-full rounded-full transition-all ${warn ? "bg-amber-500" : "bg-slate-900 dark:bg-white"}`}
                                                    style={{width: `${Math.max(pct, 1)}%`}}
                                                />
                                            </div>
                                        </div>
                                    );
                                })()}
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => void handleExport()}
                                        className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                    >
                                        Export
                                    </button>
                                    <button
                                        onClick={() => void handleClearAll()}
                                        className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-slate-700 dark:text-red-400 dark:hover:bg-red-950/30"
                                    >
                                        Clear all
                                    </button>
                                </div>
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
}
