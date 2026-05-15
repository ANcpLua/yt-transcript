import {useCallback, useEffect, useRef, useState} from "react";
import type {AiProviderId, Preferences} from "../types/transcript";
import {getApiKey, getPreferences, removeApiKey, saveApiKey, savePreferences} from "../lib/storage/preferences";
import {clearAllData, exportAllData} from "../lib/storage/saved";
import {clearHistory} from "../lib/storage/history";
import {DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL, getProvider} from "../lib/ai/providers";
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
type KeyStatus = "idle" | "validating" | "valid" | "invalid";
type TabId = "ai" | "audio" | "data";

interface ProviderInfo {
    id: AiProviderId;
    label: string;
    needsKey: boolean;
    blurb: string;
}

const PROVIDERS: ProviderInfo[] = [
    {id: "chrome-ai", label: "Chrome AI", needsKey: false, blurb: "Gemini Nano, on-device. No key, no network."},
    {id: "ollama", label: "Ollama", needsKey: false, blurb: "Local LLM via Ollama. Runs on your machine."},
    {id: "openai", label: "OpenAI", needsKey: true, blurb: "GPT-4 / GPT-4o. BYOK."},
    {id: "anthropic", label: "Anthropic", needsKey: true, blurb: "Claude. BYOK."},
    {id: "google", label: "Gemini", needsKey: true, blurb: "Gemini 1.5/2.0 via Google AI Studio. BYOK."},
];

const HF_ORIGINS = [
    "https://huggingface.co/*",
    "https://*.huggingface.co/*",
    "https://cdn-lfs.huggingface.co/*",
    "https://cdn-lfs.hf.co/*",
];

const DEFAULT_PREFS: Preferences = {
    viewMode: "raw",
    showTimestamps: true,
    compactMode: false,
    autoScroll: true,
    aiProvider: null,
    whisperModel: "tiny",
};

const INITIAL_PROVIDER_STATUS: Record<AiProviderId, ProviderStatus> = {
    "chrome-ai": "checking",
    ollama: "checking",
    openai: "checking",
    anthropic: "checking",
    google: "checking",
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

function ChevronIcon({open}: {open: boolean}) {
    return (
        <svg aria-hidden="true" className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
        </svg>
    );
}

// ---------- main component ----------

export function Settings({isOpen, onClose, onPreferencesChange}: SettingsProps) {
    const [tab, setTab] = useState<TabId>("ai");
    const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
    const [expandedProvider, setExpandedProvider] = useState<AiProviderId | null>(null);
    const [keyInput, setKeyInput] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [keyStatus, setKeyStatus] = useState<KeyStatus>("idle");
    const [storageEstimate, setStorageEstimate] = useState<{usage: number; quota: number} | null>(null);

    // Whisper state
    const [whisperState, setWhisperState] = useState<WhisperState>("unknown");
    const [whisperProgress, setWhisperProgress] = useState(0);
    const [whisperError, setWhisperError] = useState<string | null>(null);
    const [hfPermissionGranted, setHfPermissionGranted] = useState<boolean | null>(null);

    // AI provider details
    const [chromeAiStatus, setChromeAiStatus] = useState<"checking" | "available" | "summarizer-only" | "unavailable">("checking");
    const [ollamaUrl, setOllamaUrl] = useState(DEFAULT_OLLAMA_URL);
    const [ollamaModel, setOllamaModel] = useState(DEFAULT_OLLAMA_MODEL);
    const [ollamaStatus, setOllamaStatus] = useState<"idle" | "checking" | "ok" | "fail">("idle");
    const [providerStatus, setProviderStatus] = useState<Record<AiProviderId, ProviderStatus>>(INITIAL_PROVIDER_STATUS);

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
            setExpandedProvider(p.aiProvider);
            setOllamaUrl(p.ollamaUrl ?? DEFAULT_OLLAMA_URL);
            setOllamaModel(p.ollamaModel ?? DEFAULT_OLLAMA_MODEL);
        })();
        return () => { cancelled = true; };
    }, [isOpen]);

    // ----- Chrome AI probe -----
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setProviderStatus((s) => ({...s, "chrome-ai": "checking"}));
        void (async () => {
            const promptOk = await isChromeAiPromptAvailable();
            if (cancelled) return;
            if (promptOk) {
                setChromeAiStatus("available");
                setProviderStatus((s) => ({...s, "chrome-ai": "ready"}));
                return;
            }
            const summarizerOk = await isChromeAiAvailable();
            if (cancelled) return;
            setChromeAiStatus(summarizerOk ? "summarizer-only" : "unavailable");
            setProviderStatus((s) => ({...s, "chrome-ai": summarizerOk ? "saved" : "unreachable"}));
        })();
        return () => { cancelled = true; };
    }, [isOpen]);

    // ----- BYOK key presence -----
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        void (async () => {
            const checks = await Promise.all([
                getApiKey("openai"),
                getApiKey("anthropic"),
                getApiKey("google"),
            ]);
            if (cancelled) return;
            setProviderStatus((s) => ({
                ...s,
                openai: checks[0] ? "saved" : "needs-config",
                anthropic: checks[1] ? "saved" : "needs-config",
                google: checks[2] ? "saved" : "needs-config",
            }));
        })();
        return () => { cancelled = true; };
    }, [isOpen]);

    // ----- Ollama probe -----
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setProviderStatus((s) => ({...s, ollama: "checking"}));
        void (async () => {
            const provider = getProvider("ollama", {
                url: (ollamaUrl || DEFAULT_OLLAMA_URL).trim(),
                model: (ollamaModel || DEFAULT_OLLAMA_MODEL).trim(),
            });
            const ok = await provider.validateKey();
            if (cancelled) return;
            setProviderStatus((s) => ({...s, ollama: ok ? "ready" : "unreachable"}));
        })();
        return () => { cancelled = true; };
    }, [isOpen, ollamaUrl, ollamaModel]);

    // ----- selected provider key reload -----
    useEffect(() => {
        if (!isOpen || !expandedProvider) return;
        let cancelled = false;
        void (async () => {
            const existing = await getApiKey(expandedProvider);
            if (cancelled) return;
            setKeyInput(existing ?? "");
            setKeyStatus("idle");
        })();
        return () => { cancelled = true; };
    }, [isOpen, expandedProvider]);

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

        chrome.runtime.sendMessage({type: "check-whisper-status"}, (response: {downloaded?: boolean} | undefined) => {
            if (cancelled) return;
            setWhisperState(response?.downloaded ? "ready" : "not-downloaded");
        });

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
    }, [isOpen]);

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

    // Auto-pick first ready provider when none is configured yet.
    useEffect(() => {
        if (!isOpen) return;
        if (prefs.aiProvider) return;
        for (const p of PROVIDERS) {
            if (providerStatus[p.id] === "ready") {
                updatePref("aiProvider", p.id);
                setExpandedProvider(p.id);
                return;
            }
        }
    }, [isOpen, prefs.aiProvider, providerStatus, updatePref]);

    // ----- handlers -----

    const handleSaveKey = async () => {
        if (!expandedProvider || !keyInput.trim()) return;
        setKeyStatus("validating");
        const provider = getProvider(expandedProvider, keyInput.trim());
        const valid = await provider.validateKey();
        if (valid) {
            await saveApiKey(expandedProvider, keyInput.trim());
            updatePref("aiProvider", expandedProvider);
            setKeyStatus("valid");
            setProviderStatus((s) => ({...s, [expandedProvider]: "ready"}));
        } else {
            setKeyStatus("invalid");
            setProviderStatus((s) => ({...s, [expandedProvider]: "unreachable"}));
        }
    };

    const handleClearKey = async () => {
        if (!expandedProvider) return;
        await removeApiKey(expandedProvider);
        setKeyInput("");
        setKeyStatus("idle");
        setProviderStatus((s) => ({...s, [expandedProvider]: "needs-config"}));
        if (prefs.aiProvider === expandedProvider) {
            updatePref("aiProvider", null);
        }
    };

    const handleSelectChromeAi = () => {
        if (chromeAiStatus === "unavailable") return;
        updatePref("aiProvider", "chrome-ai");
    };

    const handleTestOllama = async () => {
        setOllamaStatus("checking");
        setProviderStatus((s) => ({...s, ollama: "checking"}));
        const provider = getProvider("ollama", {
            url: ollamaUrl.trim() || DEFAULT_OLLAMA_URL,
            model: ollamaModel.trim() || DEFAULT_OLLAMA_MODEL,
        });
        const ok = await provider.validateKey();
        setOllamaStatus(ok ? "ok" : "fail");
        setProviderStatus((s) => ({...s, ollama: ok ? "ready" : "unreachable"}));
        if (ok) {
            const next = {
                ...prefs,
                aiProvider: "ollama" as const,
                ollamaUrl: ollamaUrl.trim() || DEFAULT_OLLAMA_URL,
                ollamaModel: ollamaModel.trim() || DEFAULT_OLLAMA_MODEL,
            };
            setPrefs(next);
            void savePreferences(next);
            onPreferencesChange(next);
        }
    };

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
    const handleWhisperModelChange = (model: "tiny" | "base") => {
        updatePref("whisperModel", model);
        setWhisperProgress(0);
        setWhisperError(null);
        if (whisperState === "downloading" || whisperState === "ready") {
            setWhisperState("not-downloaded");
        }
    };

    if (!isOpen) return null;

    const activeProvider = prefs.aiProvider;
    const activeProviderInfo = PROVIDERS.find((p) => p.id === activeProvider);
    const activeProviderStatus = activeProvider ? providerStatus[activeProvider] : null;

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
                            {/* Active provider summary */}
                            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
                                <span className="text-xs text-slate-500 dark:text-slate-400">Active provider</span>
                                {activeProvider && activeProviderInfo && activeProviderStatus ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                                        <StatusDot status={activeProviderStatus}/>
                                        {activeProviderInfo.label}
                                        {activeProviderStatus === "ready" && " — ready"}
                                        {activeProviderStatus === "saved" && " — saved"}
                                        {activeProviderStatus === "unreachable" && " — failing"}
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                        <StatusDot status="needs-config"/>
                                        Pick one below
                                    </span>
                                )}
                            </div>

                            {/* Provider cards */}
                            <div className="space-y-2">
                                {PROVIDERS.map((p) => {
                                    const status = providerStatus[p.id];
                                    const isExpanded = expandedProvider === p.id;
                                    const isActive = prefs.aiProvider === p.id;
                                    return (
                                        <div
                                            key={p.id}
                                            className={`rounded-lg border transition-colors ${
                                                isActive
                                                    ? "border-slate-900 dark:border-white"
                                                    : "border-slate-200 dark:border-slate-700"
                                            }`}
                                        >
                                            <button
                                                onClick={() => setExpandedProvider(isExpanded ? null : p.id)}
                                                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium text-slate-900 dark:text-white">
                                                            {p.label}
                                                        </span>
                                                        {isActive && (
                                                            <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                                                Active
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{p.blurb}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <StatusDot status={status}/>
                                                    <ChevronIcon open={isExpanded}/>
                                                </div>
                                            </button>
                                            {isExpanded && (
                                                <div className="border-t border-slate-100 px-3 py-3 dark:border-slate-800">
                                                    {p.id === "chrome-ai" && (
                                                        <div className="space-y-2">
                                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                                {chromeAiStatus === "checking" && "Checking…"}
                                                                {chromeAiStatus === "available" && "Ready — supports every feature."}
                                                                {chromeAiStatus === "summarizer-only" && "Summary only. Enable the Prompt API flag for the rest."}
                                                                {chromeAiStatus === "unavailable" && (
                                                                    <>
                                                                        Not detected. In Edge or Chrome 138+, enable the Prompt API flag at{" "}
                                                                        <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">chrome://flags</code>
                                                                        {" "}then restart.
                                                                    </>
                                                                )}
                                                            </p>
                                                            {isActive ? (
                                                                <span className="text-xs text-slate-500 dark:text-slate-400">Selected as your AI provider.</span>
                                                            ) : (
                                                                <button
                                                                    onClick={handleSelectChromeAi}
                                                                    disabled={chromeAiStatus === "unavailable"}
                                                                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                                                                >
                                                                    Use Chrome AI
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}

                                                    {p.id === "ollama" && (
                                                        <div className="space-y-3">
                                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                                Local LLM via{" "}
                                                                <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500 dark:decoration-slate-600">Ollama</a>.
                                                                Run <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">ollama pull llama3.2</code> first.
                                                            </p>
                                                            <div className="grid gap-2">
                                                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                                                    Server
                                                                    <input
                                                                        type="text"
                                                                        value={ollamaUrl}
                                                                        onChange={(e) => { setOllamaUrl(e.target.value); setOllamaStatus("idle"); }}
                                                                        placeholder={DEFAULT_OLLAMA_URL}
                                                                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                                                    />
                                                                </label>
                                                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                                                    Model
                                                                    <input
                                                                        type="text"
                                                                        value={ollamaModel}
                                                                        onChange={(e) => { setOllamaModel(e.target.value); setOllamaStatus("idle"); }}
                                                                        placeholder={DEFAULT_OLLAMA_MODEL}
                                                                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                                                    />
                                                                </label>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    onClick={() => void handleTestOllama()}
                                                                    disabled={ollamaStatus === "checking"}
                                                                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                                                                >
                                                                    {ollamaStatus === "checking" ? "Testing…" : isActive ? "Update" : "Test connection"}
                                                                </button>
                                                                {ollamaStatus === "ok" && <span className="text-xs text-emerald-600 dark:text-emerald-400">Connected</span>}
                                                                {ollamaStatus === "fail" && <span className="text-xs text-red-600 dark:text-red-400">Could not reach Ollama</span>}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {p.needsKey && (
                                                        <div className="space-y-2">
                                                            <div className="flex gap-2">
                                                                <input
                                                                    type={showKey ? "text" : "password"}
                                                                    value={keyInput}
                                                                    onChange={(e) => { setKeyInput(e.target.value); setKeyStatus("idle"); }}
                                                                    onFocus={() => setShowKey(true)}
                                                                    onBlur={() => setShowKey(false)}
                                                                    placeholder="API key"
                                                                    spellCheck={false}
                                                                    className="flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                                                />
                                                                <button
                                                                    onClick={() => void handleSaveKey()}
                                                                    disabled={keyStatus === "validating" || !keyInput.trim()}
                                                                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                                                                >
                                                                    {keyStatus === "validating" ? "Testing…" : keyStatus === "valid" ? "Re-test" : "Save & test"}
                                                                </button>
                                                            </div>
                                                            <div className="flex items-center justify-between">
                                                                <p className="text-[11px] text-slate-500 dark:text-slate-400">Stored locally. Save & test pings the provider once.</p>
                                                                {keyInput && (
                                                                    <button
                                                                        onClick={() => void handleClearKey()}
                                                                        className="text-[11px] text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                                                    >
                                                                        Clear
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {keyStatus === "valid" && (
                                                                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">Verified.</p>
                                                            )}
                                                            {keyStatus === "invalid" && (
                                                                <p className="text-[11px] text-red-600 dark:text-red-400">Rejected by the provider.</p>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
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
                                <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Preferences</h3>
                                <div className="space-y-2.5">
                                    <label className="flex items-center justify-between">
                                        <span className="text-sm text-slate-700 dark:text-slate-300">View</span>
                                        <select
                                            value={prefs.viewMode}
                                            onChange={(e) => updatePref("viewMode", e.target.value as Preferences["viewMode"])}
                                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                        >
                                            <option value="raw">Raw</option>
                                            <option value="sentences">Sentences</option>
                                            <option value="paragraphs">Paragraphs</option>
                                            <option value="tabular">Tabular</option>
                                        </select>
                                    </label>
                                    {([
                                        {key: "showTimestamps" as const, label: "Show timestamps"},
                                        {key: "compactMode" as const, label: "Compact mode"},
                                        {key: "autoScroll" as const, label: "Auto-scroll"},
                                    ]).map(({key, label}) => (
                                        <label key={key} className="flex items-center justify-between">
                                            <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
                                            <input
                                                type="checkbox"
                                                checked={prefs[key]}
                                                onChange={(e) => updatePref(key, e.target.checked)}
                                                className="h-4 w-4 rounded-sm accent-slate-900 dark:accent-white"
                                            />
                                        </label>
                                    ))}
                                </div>
                            </div>

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
