import {useCallback, useEffect, useState} from "react";
import type {AiProviderId, Preferences} from "../types/transcript";
import {getApiKey, getPreferences, removeApiKey, saveApiKey, savePreferences} from "../lib/storage/preferences";
import {clearAllData, exportAllData} from "../lib/storage/saved";
import {clearHistory} from "../lib/storage/history";
import {DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL, getProvider} from "../lib/ai/providers";
import {isChromeAiAvailable, isChromeAiPromptAvailable} from "../lib/ai/chrome-ai";

type WhisperState = "unknown" | "not-downloaded" | "downloading" | "ready";

// Per-provider readiness:
//  ready          – usable right now (Chrome AI available, Ollama reachable, key validated this session)
//  saved          – key/URL persisted but not verified yet (no network call made)
//  unreachable    – we tested and it failed (server down, no flag, etc.)
//  needs-config   – nothing saved, user has to set it up
//  checking       – initial probe in flight
type ProviderStatus = "ready" | "saved" | "unreachable" | "needs-config" | "checking";

const PROVIDERS: { id: AiProviderId; label: string; needsKey: boolean }[] = [
    {id: "chrome-ai", label: "Chrome AI", needsKey: false},
    {id: "ollama", label: "Ollama", needsKey: false},
    {id: "openai", label: "OpenAI", needsKey: true},
    {id: "anthropic", label: "Anthropic", needsKey: true},
    {id: "google", label: "Gemini", needsKey: true},
];

function StatusDot({status}: {status: ProviderStatus}) {
    const cls =
        status === "ready" ? "bg-emerald-500"
        : status === "saved" ? "bg-amber-400"
        : status === "unreachable" ? "bg-red-500"
        : status === "checking" ? "bg-slate-300 dark:bg-slate-600 animate-pulse"
        : "bg-slate-300 dark:bg-slate-700";
    return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} aria-hidden="true" />;
}

export function formatQuota(kb: number): string {
    if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)} GB`;
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${kb.toFixed(1)} KB`;
}

interface SettingsProps {
    isOpen: boolean;
    onClose: () => void;
    onPreferencesChange: (prefs: Preferences) => void;
}

type KeyStatus = "idle" | "validating" | "valid" | "invalid";

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

export function Settings({isOpen, onClose, onPreferencesChange}: SettingsProps) {
    const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFS);
    const [selectedProvider, setSelectedProvider] = useState<AiProviderId>("chrome-ai");
    const [keyInput, setKeyInput] = useState("");
    const [showKey, setShowKey] = useState(false);
    const [keyStatus, setKeyStatus] = useState<KeyStatus>("idle");
    const [storageEstimate, setStorageEstimate] = useState<{usage: number; quota: number} | null>(null);
    const [whisperState, setWhisperState] = useState<WhisperState>("unknown");
    const [whisperProgress, setWhisperProgress] = useState(0);
    const [chromeAiStatus, setChromeAiStatus] = useState<"checking" | "available" | "summarizer-only" | "unavailable">("checking");
    const [ollamaUrl, setOllamaUrl] = useState(DEFAULT_OLLAMA_URL);
    const [ollamaModel, setOllamaModel] = useState(DEFAULT_OLLAMA_MODEL);
    const [ollamaStatus, setOllamaStatus] = useState<"idle" | "checking" | "ok" | "fail">("idle");
    const [providerStatus, setProviderStatus] = useState<Record<AiProviderId, ProviderStatus>>(INITIAL_PROVIDER_STATUS);
    const hasWebGpu = typeof (navigator as Navigator & { gpu?: unknown }).gpu !== "undefined";

    // Load preferences once when the panel opens
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        void (async () => {
            const p = await getPreferences();
            if (cancelled) return;
            setPrefs(p);
            setSelectedProvider(p.aiProvider ?? "chrome-ai");
            setOllamaUrl(p.ollamaUrl ?? DEFAULT_OLLAMA_URL);
            setOllamaModel(p.ollamaModel ?? DEFAULT_OLLAMA_MODEL);
        })();
        return () => { cancelled = true; };
    }, [isOpen]);

    // Detect Chrome built-in AI availability
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

    // Lightweight key-presence probe for paid providers — does NOT call
    // the upstream API. The dot says "saved" until the user clicks Test.
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

    // Probe Ollama on open (cheap — local network, /api/tags).
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

    // Reload the API key whenever the selected provider tab changes
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        void (async () => {
            const existing = await getApiKey(selectedProvider);
            if (cancelled) return;
            setKeyInput(existing ?? "");
            // "valid" only after a real validateKey() call this session.
            setKeyStatus("idle");
        })();
        return () => { cancelled = true; };
    }, [isOpen, selectedProvider]);

    // Check Whisper model status
    useEffect(() => {
        if (!isOpen) return;
        chrome.runtime.sendMessage({type: "check-whisper-status"}, (response: {downloaded?: boolean} | undefined) => {
            if (response?.downloaded) setWhisperState("ready");
            else setWhisperState("not-downloaded");
        });

        const listener = (msg: {type: string; progress?: number}) => {
            if (msg.type === "download-whisper-progress") {
                if (msg.progress === 100) setWhisperState("ready");
                else {
                    setWhisperState("downloading");
                    setWhisperProgress(msg.progress ?? 0);
                }
            }
        };
        chrome.runtime.onMessage.addListener(listener);
        return () => chrome.runtime.onMessage.removeListener(listener);
    }, [isOpen]);

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

    // Auto-pick the first ready provider when nothing is set yet.
    // Preference order matches the tab order: Chrome AI > Ollama > saved keys.
    useEffect(() => {
        if (!isOpen) return;
        if (prefs.aiProvider) return;
        for (const p of PROVIDERS) {
            if (providerStatus[p.id] === "ready") {
                updatePref("aiProvider", p.id);
                setSelectedProvider(p.id);
                return;
            }
        }
    }, [isOpen, prefs.aiProvider, providerStatus, updatePref]);

    const handleSaveKey = async () => {
        if (!keyInput.trim()) return;
        setKeyStatus("validating");
        const provider = getProvider(selectedProvider, keyInput.trim());
        const valid = await provider.validateKey();
        if (valid) {
            await saveApiKey(selectedProvider, keyInput.trim());
            updatePref("aiProvider", selectedProvider);
            setKeyStatus("valid");
            setProviderStatus((s) => ({...s, [selectedProvider]: "ready"}));
        } else {
            setKeyStatus("invalid");
            setProviderStatus((s) => ({...s, [selectedProvider]: "unreachable"}));
        }
    };

    const handleClearKey = async () => {
        await removeApiKey(selectedProvider);
        setKeyInput("");
        setKeyStatus("idle");
        setProviderStatus((s) => ({...s, [selectedProvider]: "needs-config"}));
        if (prefs.aiProvider === selectedProvider) {
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
        const provider = getProvider("ollama", { url: ollamaUrl.trim() || DEFAULT_OLLAMA_URL, model: ollamaModel.trim() || DEFAULT_OLLAMA_MODEL });
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

    const totalUsageKB = storageEstimate
        ? storageEstimate.usage / 1024
        : 0;
    const quotaKB = storageEstimate ? storageEstimate.quota / 1024 : 0;
    const usagePercent = quotaKB > 0 ? Math.min((totalUsageKB / quotaKB) * 100, 100) : 0;
    const isWarning = usagePercent > 80;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm py-10" onClick={onClose}>
            <div
                className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900 dark:ring-1 dark:ring-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Settings</h2>
                    <button onClick={onClose} aria-label="Close" className="-m-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>

                {/* AI Provider */}
                <section className="mb-6">
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            AI Provider
                        </h3>
                        {(() => {
                            const active = prefs.aiProvider;
                            const activeStatus = active ? providerStatus[active] : null;
                            if (active && activeStatus === "ready") {
                                return (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                                        <StatusDot status="ready" /> Active: {PROVIDERS.find(x => x.id === active)?.label}
                                    </span>
                                );
                            }
                            if (active && activeStatus === "saved") {
                                return (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                                        <StatusDot status="saved" /> {PROVIDERS.find(x => x.id === active)?.label} — not verified
                                    </span>
                                );
                            }
                            if (active && activeStatus === "unreachable") {
                                return (
                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
                                        <StatusDot status="unreachable" /> {PROVIDERS.find(x => x.id === active)?.label} — failing
                                    </span>
                                );
                            }
                            return (
                                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                    <StatusDot status="needs-config" /> No AI configured
                                </span>
                            );
                        })()}
                    </div>
                    <div className="mb-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {PROVIDERS.map((p) => {
                            const isActive = prefs.aiProvider === p.id;
                            const isSelected = selectedProvider === p.id;
                            const status = providerStatus[p.id];
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => setSelectedProvider(p.id)}
                                    title={
                                        status === "ready" ? "Ready to use"
                                        : status === "saved" ? "Saved — click to verify"
                                        : status === "unreachable" ? "Not reachable"
                                        : status === "checking" ? "Checking…"
                                        : "Not configured"
                                    }
                                    className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition ${
                                        isSelected
                                            ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                                            : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                    }`}
                                >
                                    <span className="truncate">{p.label}</span>
                                    <span className="flex items-center gap-1">
                                        {isActive && (
                                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
                                            </svg>
                                        )}
                                        <StatusDot status={status} />
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Chrome AI panel */}
                    {selectedProvider === "chrome-ai" && (
                        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                            <p className="mb-2 text-sm text-slate-700 dark:text-slate-300">
                                Gemini Nano, on-device. No key, no network.
                            </p>
                            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                                {chromeAiStatus === "checking" && "Checking…"}
                                {chromeAiStatus === "available" && "Ready — supports every feature."}
                                {chromeAiStatus === "summarizer-only" && "Summary only. Enable the Prompt API flag for the rest."}
                                {chromeAiStatus === "unavailable" && (
                                    <>
                                        Not detected. In Edge or Chrome 138+, enable the Prompt API flag at{" "}
                                        <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">edge://flags</code>{" "}
                                        /{" "}
                                        <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">chrome://flags</code>
                                        {" "}then restart.
                                    </>
                                )}
                            </p>
                            {prefs.aiProvider === "chrome-ai" ? (
                                <span className="text-sm text-slate-500 dark:text-slate-400">Active</span>
                            ) : (
                                <button
                                    onClick={handleSelectChromeAi}
                                    disabled={chromeAiStatus === "unavailable"}
                                    className="rounded-md bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                                >
                                    Use Chrome AI
                                </button>
                            )}
                        </div>
                    )}

                    {/* Ollama panel */}
                    {selectedProvider === "ollama" && (
                        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                            <p className="mb-3 text-sm text-slate-700 dark:text-slate-300">
                                Local LLM via{" "}
                                <a href="https://ollama.com/download" target="_blank" rel="noreferrer"
                                   className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500 dark:decoration-slate-600">Ollama</a>.
                                Run <code className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">ollama pull llama3.2</code> first.
                            </p>
                            <div className="mb-3 grid gap-2">
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    Server
                                    <input
                                        type="text"
                                        value={ollamaUrl}
                                        onChange={(e) => { setOllamaUrl(e.target.value); setOllamaStatus("idle"); }}
                                        placeholder={DEFAULT_OLLAMA_URL}
                                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                    />
                                </label>
                                <label className="text-xs text-slate-500 dark:text-slate-400">
                                    Model
                                    <input
                                        type="text"
                                        value={ollamaModel}
                                        onChange={(e) => { setOllamaModel(e.target.value); setOllamaStatus("idle"); }}
                                        placeholder={DEFAULT_OLLAMA_MODEL}
                                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                    />
                                </label>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => void handleTestOllama()}
                                    disabled={ollamaStatus === "checking"}
                                    className="rounded-md bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                                >
                                    {ollamaStatus === "checking" ? "Testing…" : prefs.aiProvider === "ollama" ? "Update" : "Test connection"}
                                </button>
                                {ollamaStatus === "ok" && <span className="text-xs text-slate-500 dark:text-slate-400">Connected</span>}
                                {ollamaStatus === "fail" && <span className="text-xs text-red-600 dark:text-red-400">Could not reach Ollama</span>}
                            </div>
                        </div>
                    )}

                    {/* Paid providers — API key input */}
                    {(selectedProvider === "openai" || selectedProvider === "anthropic" || selectedProvider === "google") && (
                        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                            <div className="flex gap-2">
                                <input
                                    type={showKey ? "text" : "password"}
                                    value={keyInput}
                                    onChange={(e) => { setKeyInput(e.target.value); setKeyStatus("idle"); }}
                                    onFocus={() => setShowKey(true)}
                                    onBlur={() => setShowKey(false)}
                                    placeholder="API key"
                                    spellCheck={false}
                                    className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                                />
                                <button
                                    onClick={() => void handleSaveKey()}
                                    disabled={keyStatus === "validating" || !keyInput.trim()}
                                    className="rounded-md bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                                >
                                    {keyStatus === "validating" ? "Testing…" : keyStatus === "valid" ? "Re-test" : "Save & test"}
                                </button>
                                {keyInput && (
                                    <button
                                        onClick={() => void handleClearKey()}
                                        className="rounded-md px-2 py-1.5 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                            <div className="mt-2 flex items-center justify-between">
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Stored only in this browser. Save & test pings the provider once.
                                </p>
                                {keyStatus === "idle" && providerStatus[selectedProvider] === "saved" && (
                                    <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                        <StatusDot status="saved" /> Saved (untested)
                                    </span>
                                )}
                                {keyStatus === "valid" && (
                                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                                        <StatusDot status="ready" /> Verified
                                    </span>
                                )}
                                {keyStatus === "invalid" && (
                                    <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                                        <StatusDot status="unreachable" /> Rejected
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </section>

                {/* Local Transcription */}
                <section className="mb-6">
                    <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Local Transcription
                    </h3>
                    <div className="space-y-3">
                        <label className="flex items-center justify-between">
                            <span className="text-sm text-slate-700 dark:text-slate-300">Model</span>
                            <select
                                value={prefs.whisperModel}
                                onChange={(e) => updatePref("whisperModel", e.target.value as "tiny" | "base")}
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            >
                                <option value="tiny">Tiny — 40 MB</option>
                                <option value="base">Base — 150 MB</option>
                            </select>
                        </label>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-slate-500 dark:text-slate-400">
                                {whisperState === "ready" && "Ready"}
                                {whisperState === "not-downloaded" && "Not downloaded"}
                                {whisperState === "downloading" && `Downloading… ${whisperProgress}%`}
                                {whisperState === "unknown" && "Checking…"}
                            </span>
                            {whisperState === "not-downloaded" && (
                                <button
                                    onClick={() => {
                                        setWhisperState("downloading");
                                        chrome.runtime.sendMessage({type: "download-whisper", model: prefs.whisperModel});
                                    }}
                                    className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                    Download
                                </button>
                            )}
                            {whisperState === "ready" && (
                                <button
                                    onClick={() => {
                                        chrome.runtime.sendMessage({type: "delete-whisper"});
                                        setWhisperState("not-downloaded");
                                    }}
                                    className="rounded-md px-2 py-1 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                >
                                    Delete
                                </button>
                            )}
                        </div>
                        {whisperState === "downloading" && (
                            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                <div
                                    className="h-full rounded-full bg-slate-400 transition-all dark:bg-slate-500"
                                    style={{width: `${Math.max(whisperProgress, 2)}%`}}
                                />
                            </div>
                        )}
                    </div>
                    <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                        Auto-runs when a video has no captions. {hasWebGpu ? "WebGPU on." : "WebGPU off — WASM fallback."}
                    </p>
                </section>

                {/* Preferences + Storage — collapsed by default */}
                <details className="mb-2 group">
                    <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                        <span className="inline-flex items-center gap-1">
                            <svg className="h-3 w-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                            </svg>
                            More
                        </span>
                    </summary>
                    <div className="mt-4 space-y-5">
                        <section>
                            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Preferences</h3>
                            <div className="space-y-2">
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
                                {(["showTimestamps", "compactMode", "autoScroll"] as const).map((key) => (
                                    <label key={key} className="flex items-center justify-between">
                                        <span className="text-sm text-slate-700 dark:text-slate-300">
                                            {key === "showTimestamps" ? "Show timestamps" : key === "compactMode" ? "Compact mode" : "Auto-scroll"}
                                        </span>
                                        <input
                                            type="checkbox"
                                            checked={prefs[key]}
                                            onChange={(e) => updatePref(key, e.target.checked)}
                                            className="h-4 w-4 rounded-sm accent-slate-900 dark:accent-white"
                                        />
                                    </label>
                                ))}
                            </div>
                        </section>

                        <section>
                            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Storage</h3>
                            {storageEstimate && quotaKB > 0 && (
                                <div className="mb-3">
                                    <div className="mb-1.5 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                                        <span>{formatQuota(totalUsageKB)} used</span>
                                        <span>of {formatQuota(quotaKB)}</span>
                                    </div>
                                    <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                        <div
                                            className={`h-full rounded-full transition-all ${isWarning ? "bg-amber-500" : "bg-slate-400 dark:bg-slate-500"}`}
                                            style={{width: `${Math.max(usagePercent, 1)}%`}}
                                        />
                                    </div>
                                </div>
                            )}
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
                        </section>
                    </div>
                </details>
            </div>
        </div>
    );
}
