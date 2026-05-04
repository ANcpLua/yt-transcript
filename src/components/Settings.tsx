import {useCallback, useEffect, useState} from "react";
import type {AiProviderId, Preferences} from "../types/transcript";
import {getApiKey, getPreferences, removeApiKey, saveApiKey, savePreferences} from "../lib/storage/preferences";
import {clearAllData, exportAllData} from "../lib/storage/saved";
import {clearHistory} from "../lib/storage/history";
import {DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL, getProvider} from "../lib/ai/providers";
import {isChromeAiAvailable, isChromeAiPromptAvailable} from "../lib/ai/chrome-ai";

type WhisperState = "unknown" | "not-downloaded" | "downloading" | "ready";


const PROVIDERS: { id: AiProviderId; label: string }[] = [
    {id: "chrome-ai", label: "Chrome AI"},
    {id: "ollama", label: "Ollama"},
    {id: "openai", label: "OpenAI"},
    {id: "anthropic", label: "Anthropic"},
    {id: "google", label: "Gemini"},
];

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
        void (async () => {
            const promptOk = await isChromeAiPromptAvailable();
            if (cancelled) return;
            if (promptOk) {
                setChromeAiStatus("available");
                return;
            }
            const summarizerOk = await isChromeAiAvailable();
            if (cancelled) return;
            setChromeAiStatus(summarizerOk ? "summarizer-only" : "unavailable");
        })();
        return () => { cancelled = true; };
    }, [isOpen]);

    // Reload the API key whenever the selected provider tab changes
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        void (async () => {
            const existing = await getApiKey(selectedProvider);
            if (cancelled) return;
            setKeyInput(existing ?? "");
            setKeyStatus(existing ? "valid" : "idle");
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

    const handleSaveKey = async () => {
        if (!keyInput.trim()) return;
        setKeyStatus("validating");
        const provider = getProvider(selectedProvider, keyInput.trim());
        const valid = await provider.validateKey();
        if (valid) {
            await saveApiKey(selectedProvider, keyInput.trim());
            updatePref("aiProvider", selectedProvider);
            setKeyStatus("valid");
        } else {
            setKeyStatus("invalid");
        }
    };

    const handleClearKey = async () => {
        await removeApiKey(selectedProvider);
        setKeyInput("");
        setKeyStatus("idle");
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
        const provider = getProvider("ollama", { url: ollamaUrl.trim() || DEFAULT_OLLAMA_URL, model: ollamaModel.trim() || DEFAULT_OLLAMA_MODEL });
        const ok = await provider.validateKey();
        setOllamaStatus(ok ? "ok" : "fail");
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
                    <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        AI Provider
                    </h3>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                        {PROVIDERS.map((p) => {
                            const isActive = prefs.aiProvider === p.id;
                            const isSelected = selectedProvider === p.id;
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => setSelectedProvider(p.id)}
                                    className={`relative rounded-md px-3 py-1.5 text-sm transition ${
                                        isSelected
                                            ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                                            : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                                    }`}
                                >
                                    {p.label}
                                    {isActive && !isSelected && (
                                        <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 align-middle" aria-label="active" />
                                    )}
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
                                {chromeAiStatus === "unavailable" && "Needs Edge or Chrome 138+ with the Prompt API flag enabled."}
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
                        <>
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
                                    {keyStatus === "validating" ? "…" : "Save"}
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
                                    Stored only in this browser.
                                </p>
                                {keyStatus === "valid" && <span className="text-xs text-slate-500 dark:text-slate-400">Valid</span>}
                                {keyStatus === "invalid" && <span className="text-xs text-red-600 dark:text-red-400">Invalid</span>}
                            </div>
                        </>
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
                        Used when a video has no captions. Runs in-browser, Chrome only.
                    </p>
                </section>

                {/* Preferences */}
                <section className="mb-6">
                    <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Preferences
                    </h3>
                    <div className="space-y-3">
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

                {/* Storage */}
                <section>
                    <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Storage
                    </h3>

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
                            {isWarning && (
                                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                                    Usage is high ({usagePercent.toFixed(0)}%). Export or clear old data.
                                </p>
                            )}
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
        </div>
    );
}
