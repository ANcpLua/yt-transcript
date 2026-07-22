import {useEffect, useState} from "react";
import type {Preferences} from "../types/transcript";
import {clearAllData, exportAllData} from "../lib/storage/saved";
import {clearHistory} from "../lib/storage/history";
import {isChromeAiAvailable, isChromeAiPromptAvailable} from "../lib/ai/chrome-ai";

// ---------- types & constants ----------

type ProviderStatus = "ready" | "saved" | "unreachable" | "checking";
type TabId = "ai" | "data";

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

export function Settings({isOpen, onClose}: SettingsProps) {
    const [tab, setTab] = useState<TabId>("ai");
    const [storageEstimate, setStorageEstimate] = useState<{usage: number; quota: number} | null>(null);
    const [chromeAiStatus, setChromeAiStatus] = useState<"checking" | "available" | "summarizer-only" | "unavailable">("checking");
    const [chromeAiProviderStatus, setChromeAiProviderStatus] = useState<ProviderStatus>("checking");

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
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    On-device transcription of captionless or dropped-in videos also uses Chrome's built-in AI and needs a supported GPU.
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
