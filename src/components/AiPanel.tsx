import {Children, createElement, type ReactNode, useCallback, useEffect, useRef, useState} from "react";
import ReactMarkdown, {type Components} from "react-markdown";
import remarkGfm from "remark-gfm";
import type {AiFeature, TranscriptResponse} from "../types/transcript";
import {buildUserMessage, CHAT_BASE_SYSTEM, getChatSystemPrompt, promptTemplates, truncateForProvider} from "../lib/ai/prompts";
import {getApiKey, getPreferences} from "../lib/storage/preferences";
import {formatTimestamp} from "../lib/formatTime";
import {chromeAiSummarize, isChromeAiAvailable, isChromeAiPromptAvailable, runChromeAiPrompt} from "../lib/ai/chrome-ai";

interface AiPanelProps {
    transcript: TranscriptResponse | null;
    onSeek: (time: number) => void;
}

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

// Features that can use legacy Chrome AI Summarizer API (only summary).
// Prompt API supports all features when available.
const CHROME_AI_LEGACY_FEATURES: ReadonlySet<AiFeature> = new Set<AiFeature>(["summary"]);

const FEATURES: { id: AiFeature; label: string }[] = [
    {id: "summary", label: "Summary"},
    {id: "bulletPoints", label: "Key points"},
    {id: "qaExtract", label: "Q&A"},
];

const TIMESTAMP_SPLIT_RE = /(\d{1,2}:\d{2})/g;
const TIMESTAMP_TEST_RE = /^\d{1,2}:\d{2}$/;

function transcriptToText(transcript: TranscriptResponse): string {
    return transcript.segments
        .map((s) => `[${formatTimestamp(s.start)}] ${s.text}`)
        .join("\n");
}

function parseTimestamp(ts: string): number {
    const parts = ts.split(":").map(Number);
    return parts.length === 2 ? (parts[0] ?? 0) * 60 + (parts[1] ?? 0) : 0;
}

interface AiRequestPayload {
    provider: string;
    apiKey: string;
    systemPrompt: string;
    userMessage: string;
    ollamaUrl?: string;
    ollamaModel?: string;
}

function isAbortError(err: unknown): boolean {
    return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Route an AI request through the Chrome extension background worker.
 * If `signal` aborts, the promise rejects with AbortError; the SW request
 * is allowed to complete in the background (its result is discarded).
 */
function sendAiRequest(payload: AiRequestPayload, signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let settled = false;
        const onAbort = () => {
            if (settled) return;
            settled = true;
            reject(new DOMException("Aborted", "AbortError"));
        };
        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener("abort", onAbort, {once: true});

        chrome.runtime.sendMessage(
            {type: "ai-request", ...payload},
            (response: {type: string; content?: string; error?: string} | undefined) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener("abort", onAbort);
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message ?? "Extension error"));
                    return;
                }
                if (!response) {
                    reject(new Error("No response from background worker"));
                    return;
                }
                if (response.type === "ai-result" && response.content) {
                    resolve(response.content);
                } else {
                    reject(new Error(response.error ?? "AI request failed"));
                }
            },
        );
    });
}

const TIMESTAMP_BUTTON_CLASS =
    "mx-0.5 rounded font-mono text-xs text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 hover:decoration-slate-500 dark:text-slate-400 dark:decoration-slate-600 dark:hover:text-white";

function TimestampButton({ts, onSeek}: { ts: string; onSeek: (t: number) => void }) {
    return (
        <button onClick={() => onSeek(parseTimestamp(ts))} className={TIMESTAMP_BUTTON_CLASS}>
            {ts}
        </button>
    );
}

/** Walk children; in plain string nodes, replace MM:SS substrings with clickable buttons. */
function processTimestampsInChildren(children: ReactNode, onSeek: (t: number) => void): ReactNode {
    return Children.map(children, (child, i) => {
        if (typeof child !== "string") return child;
        if (!TIMESTAMP_SPLIT_RE.test(child)) return child;
        const parts = child.split(TIMESTAMP_SPLIT_RE);
        return parts.map((part, j) =>
            TIMESTAMP_TEST_RE.test(part)
                ? <TimestampButton key={`${i}-${j}`} ts={part} onSeek={onSeek}/>
                : part,
        );
    });
}

function makeMdComponents(onSeek: (t: number) => void): Components {
    const wrap = (tag: "p" | "li" | "td" | "th") =>
        ({children}: { children?: ReactNode }) =>
            createElement(tag, null, processTimestampsInChildren(children, onSeek));
    return {
        p: wrap("p"),
        li: wrap("li"),
        td: wrap("td"),
        th: wrap("th"),
        // Backtick-wrapped timestamps like `02:55` become inline buttons; other code stays code.
        code: ({children, ...rest}) => {
            if (typeof children === "string" && TIMESTAMP_TEST_RE.test(children.trim())) {
                return <TimestampButton ts={children.trim()} onSeek={onSeek}/>;
            }
            if (Array.isArray(children) && children.length === 1 && typeof children[0] === "string"
                && TIMESTAMP_TEST_RE.test(children[0].trim())) {
                return <TimestampButton ts={children[0].trim()} onSeek={onSeek}/>;
            }
            return <code {...rest}>{children}</code>;
        },
        // Anchors from autolinked URLs — render but never wrap timestamps inside.
        a: ({children, href}) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
    };
}

function RenderedContent({text, onSeek}: { text: string; onSeek: (t: number) => void }) {
    const components = makeMdComponents(onSeek);
    return (
        <div className="prose prose-sm prose-slate max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {text}
            </ReactMarkdown>
        </div>
    );
}


export function AiPanel({transcript, onSeek}: AiPanelProps) {
    const [result, setResult] = useState<string | null>(null);
    const [activeFeature, setActiveFeature] = useState<AiFeature | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [chatLoading, setChatLoading] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const [chromeAiAvailable, setChromeAiAvailable] = useState(false);
    const [chromeAiPromptAvailable, setChromeAiPromptAvailable] = useState(false);
    const [hasApiKey, setHasApiKey] = useState(false);

    // One AbortController per active feature request. Switching features or
    // navigating to a new transcript aborts whatever was running so the user
    // is never locked into waiting on Chrome AI / a paid API to finish.
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({behavior: "smooth"});
    }, [chatMessages]);

    // Switching videos invalidates whatever AI request was in flight.
    const transcriptKey = transcript?.videoId ?? null;
    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, [transcriptKey]);

    // Check Chrome AI and BYOK key availability on mount
    useEffect(() => {
        void isChromeAiAvailable().then(setChromeAiAvailable);
        void isChromeAiPromptAvailable().then(setChromeAiPromptAvailable);
        void (async () => {
            const prefs = await getPreferences();
            if (!prefs.aiProvider) return;
            if (prefs.aiProvider === "chrome-ai" || prefs.aiProvider === "ollama") {
                setHasApiKey(true);
                return;
            }
            const key = await getApiKey(prefs.aiProvider);
            setHasApiKey(key !== null);
        })();
    }, []);

    /** True if this feature can run (Chrome AI Prompt API supports all; legacy summarizer only summary; otherwise needs configured provider). */
    const canRunFeature = useCallback(
        (feature: AiFeature): boolean => {
            if (chromeAiPromptAvailable) return true;
            if (chromeAiAvailable && CHROME_AI_LEGACY_FEATURES.has(feature)) return true;
            return hasApiKey;
        },
        [chromeAiAvailable, chromeAiPromptAvailable, hasApiKey],
    );

    const hasAnyProvider = chromeAiAvailable || chromeAiPromptAvailable || hasApiKey;

    const runFeature = async (feature: AiFeature) => {
        if (!transcript) return;
        if (!canRunFeature(feature)) return;

        // Abort whatever's running and stake a new controller for this request.
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const {signal} = controller;

        setActiveFeature(feature);
        setLoading(true);
        setError(null);
        setResult(null);

        const commitResult = (text: string): void => {
            if (signal.aborted) return;
            setResult(text);
        };

        try {
            const text = transcriptToText(transcript);
            const template = promptTemplates[feature];
            const prefs = await getPreferences();
            if (signal.aborted) return;

            // Route 1: User explicitly chose Chrome AI → run in panel via LanguageModel.
            if (prefs.aiProvider === "chrome-ai" && chromeAiPromptAvailable) {
                commitResult(await runChromeAiPrompt(template.system, template.instructions, {trimmableContent: text, signal}));
                return;
            }

            // Route 2: User chose Ollama → service worker proxies the localhost call.
            if (prefs.aiProvider === "ollama") {
                const response = await sendAiRequest({
                    provider: "ollama",
                    apiKey: "",
                    systemPrompt: template.system,
                    userMessage: buildUserMessage(template, truncateForProvider(text, "ollama")),
                    ollamaUrl: prefs.ollamaUrl,
                    ollamaModel: prefs.ollamaModel,
                }, signal);
                commitResult(response);
                return;
            }

            // Route 3: No paid provider but legacy Summarizer is available → use it for summary.
            if (!prefs.aiProvider && chromeAiAvailable && CHROME_AI_LEGACY_FEATURES.has(feature)) {
                commitResult(await chromeAiSummarize(text));
                return;
            }

            // Route 4: No provider chosen but Prompt API works → use it as the free default.
            if (!prefs.aiProvider && chromeAiPromptAvailable) {
                commitResult(await runChromeAiPrompt(template.system, template.instructions, {trimmableContent: text, signal}));
                return;
            }

            // Route 5: Paid BYOK provider via service worker.
            if (!prefs.aiProvider) throw new Error("No AI provider configured. Open Settings to choose one.");
            const apiKey = await getApiKey(prefs.aiProvider);
            if (!apiKey) throw new Error(`No API key configured for ${prefs.aiProvider}.`);

            const response = await sendAiRequest({
                provider: prefs.aiProvider,
                apiKey,
                systemPrompt: template.system,
                userMessage: buildUserMessage(template, truncateForProvider(text, "paid")),
            }, signal);
            commitResult(response);
        } catch (err) {
            if (signal.aborted || isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "AI request failed");
        } finally {
            // Only the most-recent request flips loading off; older ones may
            // still be unwinding in the background but they no longer own UI state.
            if (abortRef.current === controller) setLoading(false);
        }
    };

    const cancelActiveRequest = useCallback(() => {
        abortRef.current?.abort();
        setLoading(false);
    }, []);

    const canChat = chromeAiPromptAvailable || hasApiKey;

    const sendChat = async () => {
        if (!chatInput.trim() || !transcript) return;
        if (!canChat) return;

        const userMsg: ChatMessage = {role: "user", content: chatInput.trim()};
        setChatMessages((prev) => [...prev, userMsg]);
        setChatInput("");
        setChatLoading(true);

        try {
            const prefs = await getPreferences();
            const transcriptText = transcriptToText(transcript);
            const history = [...chatMessages, userMsg]
                .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
                .join("\n\n");

            // Chrome AI Prompt API — transcript goes into trimmableContent so it can
            // be measured against the session quota rather than baked into the system prompt.
            if ((prefs.aiProvider === "chrome-ai" || !prefs.aiProvider) && chromeAiPromptAvailable) {
                const userPrefix = `Conversation so far:\n\n${history}\n\nAnswer the latest question using the transcript below.`;
                const response = await runChromeAiPrompt(CHAT_BASE_SYSTEM, userPrefix, {trimmableContent: transcriptText});
                setChatMessages((prev) => [...prev, {role: "assistant", content: response}]);
                return;
            }

            // Ollama — local model, conservative static cap on transcript.
            if (prefs.aiProvider === "ollama") {
                const response = await sendAiRequest({
                    provider: "ollama",
                    apiKey: "",
                    systemPrompt: getChatSystemPrompt(truncateForProvider(transcriptText, "ollama")),
                    userMessage: history,
                    ollamaUrl: prefs.ollamaUrl,
                    ollamaModel: prefs.ollamaModel,
                });
                setChatMessages((prev) => [...prev, {role: "assistant", content: response}]);
                return;
            }

            // Paid BYOK provider — large window, generous cap.
            if (!prefs.aiProvider) throw new Error("No AI provider configured");
            const apiKey = await getApiKey(prefs.aiProvider);
            if (!apiKey) throw new Error("No API key configured");
            const response = await sendAiRequest({
                provider: prefs.aiProvider,
                apiKey,
                systemPrompt: getChatSystemPrompt(truncateForProvider(transcriptText, "paid")),
                userMessage: history,
            });
            setChatMessages((prev) => [...prev, {role: "assistant", content: response}]);
        } catch (err) {
            setChatMessages((prev) => [
                ...prev,
                {role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Request failed"}`},
            ]);
        } finally {
            setChatLoading(false);
        }
    };

    const copyResult = () => {
        if (result) void navigator.clipboard.writeText(result);
    };

    if (!transcript) return null;

    const renderFeatureButton = (f: { id: AiFeature; label: string }) => {
        const enabled = canRunFeature(f.id);
        return (
            <button
                key={f.id}
                onClick={() => void runFeature(f.id)}
                disabled={!enabled}
                className={`rounded-md px-3 py-1.5 text-sm transition disabled:opacity-30 ${
                    activeFeature === f.id
                        ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
            >
                {f.label}
            </button>
        );
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="flex items-center justify-between">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-500">Analyze</h3>
                {!hasAnyProvider && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400">
                        Pick a provider →
                    </span>
                )}
            </div>

            {/* Feature buttons */}
            <div className="-mx-1 flex flex-wrap gap-1">
                {FEATURES.map(renderFeatureButton)}
            </div>

            {/* Results */}
            {loading && (
                <div className="flex items-center gap-2 py-2 text-sm text-slate-500 dark:text-slate-400">
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-700 dark:border-t-slate-300"/>
                    <span>Analyzing…</span>
                    <button
                        onClick={cancelActiveRequest}
                        className="ml-1 rounded px-1.5 text-xs text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
                    >
                        Stop
                    </button>
                </div>
            )}

            {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            {result && !loading && (
                <div>
                    <RenderedContent text={result} onSeek={onSeek}/>
                    <div className="mt-3 flex gap-3 text-xs text-slate-500 dark:text-slate-400">
                        <button onClick={copyResult} className="hover:text-slate-800 dark:hover:text-slate-200">
                            Copy
                        </button>
                        <button
                            onClick={() => activeFeature && void runFeature(activeFeature)}
                            className="hover:text-slate-800 dark:hover:text-slate-200"
                        >
                            Regenerate
                        </button>
                    </div>
                </div>
            )}

            {/* Chat */}
            <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-medium text-slate-900 dark:text-white">Ask</h4>
                    {chatMessages.length > 0 && (
                        <button
                            onClick={() => setChatMessages([])}
                            className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                        >
                            Clear
                        </button>
                    )}
                </div>

                {chatMessages.length > 0 && (
                    <div className="mb-3 max-h-64 space-y-3 overflow-y-auto">
                        {chatMessages.map((msg, i) => (
                            <div key={i} className={`text-sm ${msg.role === "user" ? "text-slate-900 dark:text-white" : "text-slate-600 dark:text-slate-300"}`}>
                                <RenderedContent text={msg.content} onSeek={onSeek}/>
                            </div>
                        ))}
                        {chatLoading && (
                            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-700 dark:border-t-slate-300"/>
                        )}
                        <div ref={chatEndRef}/>
                    </div>
                )}

                <div className="flex gap-2">
                    <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void sendChat()}
                        placeholder={canChat ? "Ask about this video" : "Pick an AI provider in Settings"}
                        disabled={!canChat || chatLoading}
                        className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-hidden disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <button
                        onClick={() => void sendChat()}
                        disabled={!canChat || chatLoading || !chatInput.trim()}
                        className="rounded-md bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-30 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    );
}

