import {useCallback, useEffect, useState} from "react";
import type {AiProviderId, Preferences} from "../types/transcript";
import {getApiKey, getPreferences, removeApiKey, saveApiKey, savePreferences} from "../lib/storage/preferences";
import {clearAllData, exportAllData} from "../lib/storage/saved";
import {clearHistory} from "../lib/storage/history";
import {DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL, getProvider} from "../lib/ai/providers";
import {isChromeAiAvailable, isChromeAiPromptAvailable} from "../lib/ai/chrome-ai";

type WhisperState = "unknown" | "not-downloaded" | "downloading" | "ready";


const PROVIDERS: { id: AiProviderId; label: string; free: boolean }[] = [
    {id: "chrome-ai", label: "Chrome AI", free: true},
    {id: "ollama", label: "Ollama", free: true},
    {id: "openai", label: "OpenAI", free: false},
    {id: "anthropic", label: "Anthropic", free: false},
    {id: "google", label: "Google Gemini", free: false},
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
            <div
                className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Settings</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>

                {/* AI Provider */}
                <section className="mb-6">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        AI Provider
                    </h3>
                    <div className="mb-3 flex flex-wrap gap-2">
                        {PROVIDERS.map((p) => {
                            const isActive = prefs.aiProvider === p.id;
                            const isSelected = selectedProvider === p.id;
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => setSelectedProvider(p.id)}
                                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                                        isSelected
                                            ? "bg-blue-600 text-white"
                                            : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"
                                    }`}
                                >
                                    {p.label}
                                    {p.free && <span className={`ml-1 text-xs ${isSelected ? "text-blue-100" : "text-green-600 dark:text-green-400"}`}>Free</span>}
                                    {isActive && <span className="ml-1">✓</span>}
                                </button>
                            );
                        })}
                    </div>

                    {/* Chrome AI panel */}
                    {selectedProvider === "chrome-ai" && (
                        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-600">
                            <p className="mb-2 text-sm text-gray-700 dark:text-gray-300">
                                Runs Gemini Nano on-device. No key, no network calls, free.
                            </p>
                            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                                {chromeAiStatus === "checking" && "Checking availability..."}
                                {chromeAiStatus === "available" && "✅ Available — supports all features."}
                                {chromeAiStatus === "summarizer-only" && "⚠️ Summarizer only. The Prompt API requires Edge/Chrome 138+ and may need chrome://flags/#prompt-api-for-gemini-nano."}
                                {chromeAiStatus === "unavailable" && "❌ Not available. Update to Edge/Chrome 138+ or enable chrome://flags/#prompt-api-for-gemini-nano."}
                            </p>
                            <button
                                onClick={handleSelectChromeAi}
                                disabled={chromeAiStatus === "unavailable"}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                                {prefs.aiProvider === "chrome-ai" ? "Selected" : "Use Chrome AI"}
                            </button>
                        </div>
                    )}

                    {/* Ollama panel */}
                    {selectedProvider === "ollama" && (
                        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-600">
                            <p className="mb-2 text-sm text-gray-700 dark:text-gray-300">
                                Local LLM via Ollama. Free. Install from{" "}
                                <a href="https://ollama.com/download" target="_blank" rel="noreferrer"
                                   className="text-blue-600 hover:underline dark:text-blue-400">ollama.com</a>,
                                run <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">ollama pull llama3.2</code>.
                            </p>
                            <div className="mb-2 grid gap-2">
                                <label className="text-xs text-gray-500 dark:text-gray-400">
                                    Server URL
                                    <input
                                        type="text"
                                        value={ollamaUrl}
                                        onChange={(e) => { setOllamaUrl(e.target.value); setOllamaStatus("idle"); }}
                                        placeholder={DEFAULT_OLLAMA_URL}
                                        className="mt-1 w-full rounded-lg border bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    />
                                </label>
                                <label className="text-xs text-gray-500 dark:text-gray-400">
                                    Model
                                    <input
                                        type="text"
                                        value={ollamaModel}
                                        onChange={(e) => { setOllamaModel(e.target.value); setOllamaStatus("idle"); }}
                                        placeholder={DEFAULT_OLLAMA_MODEL}
                                        className="mt-1 w-full rounded-lg border bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    />
                                </label>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => void handleTestOllama()}
                                    disabled={ollamaStatus === "checking"}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {ollamaStatus === "checking" ? "Testing..." : prefs.aiProvider === "ollama" ? "Update" : "Test & Use"}
                                </button>
                                {ollamaStatus === "ok" && <span className="text-sm text-green-600 dark:text-green-400">✓ Connected</span>}
                                {ollamaStatus === "fail" && <span className="text-sm text-red-600 dark:text-red-400">Could not reach Ollama</span>}
                            </div>
                            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                The extension needs permission to call localhost. Allow when prompted.
                            </p>
                        </div>
                    )}

                    {/* Paid providers — API key input */}
                    {(selectedProvider === "openai" || selectedProvider === "anthropic" || selectedProvider === "google") && (
                        <>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input
                                        type={showKey ? "text" : "password"}
                                        value={keyInput}
                                        onChange={(e) => {
                                            setKeyInput(e.target.value);
                                            setKeyStatus("idle");
                                        }}
                                        placeholder="Paste API key"
                                        className="w-full rounded-lg border bg-white px-3 py-2 pr-10 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                    />
                                    <button
                                        onClick={() => setShowKey(!showKey)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
                                        aria-label={showKey ? "Hide key" : "Show key"}
                                    >
                                        {showKey ? (
                                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
                                            </svg>
                                        ) : (
                                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                                            </svg>
                                        )}
                                    </button>
                                </div>
                                <button
                                    onClick={() => void handleSaveKey()}
                                    disabled={keyStatus === "validating" || !keyInput.trim()}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {keyStatus === "validating" ? "..." : "Save"}
                                </button>
                                <button
                                    onClick={() => void handleClearKey()}
                                    className="rounded-lg bg-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-300"
                                >
                                    Clear
                                </button>
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-sm">
                                {keyStatus === "valid" && (
                                    <span className="text-green-600 dark:text-green-400">Valid key</span>
                                )}
                                {keyStatus === "invalid" && (
                                    <span className="text-red-600 dark:text-red-400">Invalid key</span>
                                )}
                            </div>
                            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                Your API key is stored only in this browser. It is never sent to our server.
                            </p>
                        </>
                    )}
                </section>

                {/* Local Transcription */}
                <section className="mb-6">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Local Transcription
                    </h3>
                    <div className="space-y-3">
                        <label className="flex items-center justify-between">
                            <span className="text-sm text-gray-700 dark:text-gray-300">Model</span>
                            <select
                                value={prefs.whisperModel}
                                onChange={(e) => updatePref("whisperModel", e.target.value as "tiny" | "base")}
                                className="rounded-lg border px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            >
                                <option value="tiny">Tiny (40 MB, fast)</option>
                                <option value="base">Base (150 MB, better)</option>
                            </select>
                        </label>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                                {whisperState === "ready" && "Model ready"}
                                {whisperState === "not-downloaded" && "Not downloaded"}
                                {whisperState === "downloading" && `Downloading... ${whisperProgress}%`}
                                {whisperState === "unknown" && "Checking..."}
                            </span>
                            {whisperState === "not-downloaded" && (
                                <button
                                    onClick={() => {
                                        setWhisperState("downloading");
                                        chrome.runtime.sendMessage({type: "download-whisper", model: prefs.whisperModel});
                                    }}
                                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
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
                                    className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-300"
                                >
                                    Delete
                                </button>
                            )}
                        </div>
                        {whisperState === "downloading" && (
                            <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-blue-500 transition-all"
                                    style={{width: `${Math.max(whisperProgress, 2)}%`}}
                                />
                            </div>
                        )}
                    </div>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        Used when videos have no captions. Transcribes audio locally in your browser. Chrome only.
                    </p>
                </section>

                {/* Preferences */}
                <section className="mb-6">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Preferences
                    </h3>
                    <div className="space-y-3">
                        <label className="flex items-center justify-between">
                            <span className="text-sm text-gray-700 dark:text-gray-300">View mode</span>
                            <select
                                value={prefs.viewMode}
                                onChange={(e) => updatePref("viewMode", e.target.value as Preferences["viewMode"])}
                                className="rounded-lg border px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            >
                                <option value="raw">Raw</option>
                                <option value="sentences">Sentences</option>
                                <option value="paragraphs">Paragraphs</option>
                                <option value="tabular">Tabular</option>
                            </select>
                        </label>
                        {(["showTimestamps", "compactMode", "autoScroll"] as const).map((key) => (
                            <label key={key} className="flex items-center justify-between">
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {key === "showTimestamps" ? "Show timestamps" : key === "compactMode" ? "Compact mode" : "Auto-scroll"}
                </span>
                                <input
                                    type="checkbox"
                                    checked={prefs[key]}
                                    onChange={(e) => updatePref(key, e.target.checked)}
                                    className="h-4 w-4 rounded-sm"
                                />
                            </label>
                        ))}
                    </div>
                </section>

                {/* Storage */}
                <section>
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Storage
                    </h3>

                    {/* Warning banner */}
                    {isWarning && (
                        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 dark:bg-amber-900/20 dark:border-amber-700">
                            <p className="text-sm text-amber-800 dark:text-amber-300">
                                Storage usage is high ({usagePercent.toFixed(0)}%). Consider exporting and clearing old data.
                            </p>
                        </div>
                    )}

                    {/* Usage details */}
                    <div className="mb-3 space-y-2">
                        {storageEstimate && (
                            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                                <span>Storage used</span>
                                <span>~{(storageEstimate.usage / 1024).toFixed(1)} KB</span>
                            </div>
                        )}

                        {/* Progress bar */}
                        {quotaKB > 0 && (
                            <div>
                                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                                    <span>Total: ~{totalUsageKB.toFixed(1)} KB</span>
                                    <span>Quota: ~{formatQuota(quotaKB)}</span>
                                </div>
                                <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            isWarning ? "bg-amber-500" : "bg-blue-500"
                                        }`}
                                        style={{width: `${Math.max(usagePercent, 1)}%`}}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => void handleExport()}
                            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"
                        >
                            Export all data
                        </button>
                        <button
                            onClick={() => void handleClearAll()}
                            className="rounded-lg bg-red-100 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                        >
                            Clear all data
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}
