import {useCallback, useEffect, useRef, useState} from "react";
import type {AiFeature, TranscriptResponse} from "../types/transcript";
import {getProvider} from "../lib/ai/providers";
import {getChatSystemPrompt, promptTemplates} from "../lib/ai/prompts";
import {getApiKey, getPreferences} from "../lib/storage/preferences";
import {formatTimestamp} from "../lib/formatTime";

interface AiPanelProps {
    transcript: TranscriptResponse | null;
    onSeek: (time: number) => void;
}

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

const FEATURES: { id: AiFeature; label: string }[] = [
    {id: "summary", label: "Summarize"},
    {id: "bulletPoints", label: "Key Points"},
    {id: "chapterSummary", label: "Chapters"},
    {id: "actionItems", label: "Action Items"},
    {id: "quotes", label: "Quotes"},
    {id: "blogOutline", label: "Blog Outline"},
    {id: "socialPosts", label: "Social Posts"},
    {id: "studyNotes", label: "Study Notes"},
    {id: "flashcards", label: "Flashcards"},
    {id: "seoKeywords", label: "SEO Keywords"},
    {id: "entities", label: "Entities"},
];

const TIMESTAMP_RE = /(\d{1,2}:\d{2})/g;

function transcriptToText(transcript: TranscriptResponse): string {
    return transcript.segments
        .map((s) => `[${formatTimestamp(s.start)}] ${s.text}`)
        .join("\n");
}

function parseTimestamp(ts: string): number {
    const parts = ts.split(":").map(Number);
    return parts.length === 2 ? (parts[0] ?? 0) * 60 + (parts[1] ?? 0) : 0;
}

function RenderedContent({text, onSeek}: { text: string; onSeek: (t: number) => void }) {
    const parts = text.split(TIMESTAMP_RE);
    return (
        <div className="prose prose-sm max-w-none whitespace-pre-wrap dark:prose-invert">
            {parts.map((part, i) =>
                TIMESTAMP_RE.test(part) ? (
                    <button
                        key={i}
                        onClick={() => onSeek(parseTimestamp(part))}
                        className="mx-0.5 rounded bg-blue-100 px-1 text-xs font-mono text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300"
                    >
                        {part}
                    </button>
                ) : (
                    <span key={i}>{part}</span>
                ),
            )}
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
    const [flippedCards, setFlippedCards] = useState<Set<number>>(new Set());

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({behavior: "smooth"});
    }, [chatMessages]);

    const getConfiguredProvider = useCallback(() => {
        const prefs = getPreferences();
        if (!prefs.aiProvider) return null;
        const key = getApiKey(prefs.aiProvider);
        if (!key) return null;
        return getProvider(prefs.aiProvider, key);
    }, []);

    const runFeature = async (feature: AiFeature) => {
        if (!transcript) return;
        const provider = getConfiguredProvider();
        if (!provider) return;

        setActiveFeature(feature);
        setLoading(true);
        setError(null);
        setResult(null);
        setFlippedCards(new Set());

        try {
            const template = promptTemplates[feature];
            const text = transcriptToText(transcript);
            const response = await provider.sendMessage({
                systemPrompt: template.system,
                userMessage: template.user(text),
            });
            setResult(response);
        } catch (err) {
            setError(err instanceof Error ? err.message : "AI request failed");
        } finally {
            setLoading(false);
        }
    };

    const sendChat = async () => {
        if (!chatInput.trim() || !transcript) return;
        const provider = getConfiguredProvider();
        if (!provider) return;

        const userMsg: ChatMessage = {role: "user", content: chatInput.trim()};
        setChatMessages((prev) => [...prev, userMsg]);
        setChatInput("");
        setChatLoading(true);

        try {
            const systemPrompt = getChatSystemPrompt(transcriptToText(transcript));
            const history = [...chatMessages, userMsg]
                .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
                .join("\n\n");

            const response = await provider.sendMessage({
                systemPrompt,
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
        if (result) navigator.clipboard.writeText(result);
    };

    const hasProvider = getConfiguredProvider() !== null;

    if (!transcript) return null;

    return (
        <div className="flex flex-col gap-4 rounded-xl border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">AI Analysis</h3>

            {!hasProvider && (
                <div
                    className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.374-9.373A9 9 0 115.626 5.626 9 9 0 0119.374 14.627z"/>
                    </svg>
                    Add an API key in Settings to use AI features.
                </div>
            )}

            {/* Feature buttons */}
            <div className="flex flex-wrap gap-2">
                {FEATURES.map((f) => (
                    <button
                        key={f.id}
                        onClick={() => runFeature(f.id)}
                        disabled={!hasProvider || loading}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 ${
                            activeFeature === f.id
                                ? "bg-blue-600 text-white"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"
                        }`}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Results */}
            {loading && (
                <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"/>
                    Analyzing transcript...
                </div>
            )}

            {error && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                    {error}
                </div>
            )}

            {result && !loading && (
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-900">
                    {activeFeature === "flashcards" ? (
                        <FlashcardView result={result} flippedCards={flippedCards} setFlippedCards={setFlippedCards}/>
                    ) : (
                        <RenderedContent text={result} onSeek={onSeek}/>
                    )}
                    <div className="mt-3 flex gap-2">
                        <button onClick={copyResult}
                                className="rounded bg-gray-200 px-3 py-1 text-xs hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300">
                            Copy
                        </button>
                        <button
                            onClick={() => activeFeature && runFeature(activeFeature)}
                            className="rounded bg-gray-200 px-3 py-1 text-xs hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300"
                        >
                            Regenerate
                        </button>
                    </div>
                </div>
            )}

            {/* Chat */}
            <div className="border-t pt-4 dark:border-gray-700">
                <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Ask the transcript</h4>
                    {chatMessages.length > 0 && (
                        <button
                            onClick={() => setChatMessages([])}
                            className="text-xs text-gray-400 hover:text-gray-600"
                        >
                            Clear chat
                        </button>
                    )}
                </div>

                {chatMessages.length > 0 && (
                    <div className="mb-3 max-h-64 space-y-2 overflow-y-auto rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                        {chatMessages.map((msg, i) => (
                            <div
                                key={i}
                                className={`rounded-lg p-2 text-sm ${
                                    msg.role === "user"
                                        ? "ml-8 bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200"
                                        : "mr-8 bg-white dark:bg-gray-800 dark:text-gray-200"
                                }`}
                            >
                                <RenderedContent text={msg.content} onSeek={onSeek}/>
                            </div>
                        ))}
                        {chatLoading && (
                            <div className="mr-8 rounded-lg bg-white p-2 dark:bg-gray-800">
                                <div
                                    className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"/>
                            </div>
                        )}
                        <div ref={chatEndRef}/>
                    </div>
                )}

                <div className="flex gap-2">
                    <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendChat()}
                        placeholder={hasProvider ? "Ask a question about this video..." : "Add API key to chat"}
                        disabled={!hasProvider || chatLoading}
                        className="flex-1 rounded-lg border px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    />
                    <button
                        onClick={sendChat}
                        disabled={!hasProvider || chatLoading || !chatInput.trim()}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    );
}

function FlashcardView({
                           result,
                           flippedCards,
                           setFlippedCards,
                       }: {
    result: string;
    flippedCards: Set<number>;
    setFlippedCards: React.Dispatch<React.SetStateAction<Set<number>>>;
}) {
    const cards = result
        .split(/\n(?=Q:)/g)
        .map((block) => {
            const qMatch = block.match(/Q:\s*(.+)/);
            const aMatch = block.match(/A:\s*([\s\S]+)/);
            const q = qMatch?.[1];
            const a = aMatch?.[1];
            return q && a ? {q: q.trim(), a: a.trim()} : null;
        })
        .filter((c): c is { q: string; a: string } => c !== null);

    const toggle = (i: number) =>
        setFlippedCards((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i);
            else next.add(i);
            return next;
        });

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            {cards.map((card, i) => (
                <button
                    key={i}
                    onClick={() => toggle(i)}
                    className="rounded-lg border p-3 text-left transition hover:shadow dark:border-gray-600"
                >
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{card.q}</p>
                    {flippedCards.has(i) && (
                        <p className="mt-2 border-t pt-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400">
                            {card.a}
                        </p>
                    )}
                </button>
            ))}
        </div>
    );
}
