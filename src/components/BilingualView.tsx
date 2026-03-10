import type {JSX} from "react";
import {useCallback, useEffect, useRef, useState} from "react";
import type {Segment} from "../types/transcript";

interface BilingualViewProps {
    originalSegments: Segment[];
    translatedSegments: Segment[];
    showTimestamps: boolean;
    onSeek: (time: number) => void;
}

interface AlignedRow {
    original: Segment | null;
    translated: Segment | null;
}

function formatTimestamp(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function alignByTimestamp(original: Segment[], translated: Segment[]): AlignedRow[] {
    const rows: AlignedRow[] = [];
    let oi = 0;
    let ti = 0;

    while (oi < original.length && ti < translated.length) {
        const orig = original[oi];
        const trans = translated[ti];
        if (!orig || !trans) break;

        const tolerance = 0.5;

        if (Math.abs(orig.start - trans.start) <= tolerance) {
            rows.push({original: orig, translated: trans});
            oi++;
            ti++;
        } else if (orig.start < trans.start) {
            rows.push({original: orig, translated: null});
            oi++;
        } else {
            rows.push({original: null, translated: trans});
            ti++;
        }
    }

    while (oi < original.length) {
        const orig = original[oi];
        if (orig) rows.push({original: orig, translated: null});
        oi++;
    }

    while (ti < translated.length) {
        const trans = translated[ti];
        if (trans) rows.push({original: null, translated: trans});
        ti++;
    }

    return rows;
}

function SegmentCell({
                         segment,
                         showTime,
                         onSeek,
                     }: {
    segment: Segment | null;
    showTime: boolean;
    onSeek: (time: number) => void;
}): JSX.Element {
    if (segment === null) {
        return <div className="p-2 min-h-[2.5rem]"/>;
    }

    return (
        <button
            type="button"
            onClick={() => onSeek(segment.start)}
            className="w-full text-left p-2 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            aria-label={`Seek to ${formatTimestamp(segment.start)}`}
        >
            {showTime && (
                <span className="text-xs font-mono text-blue-600 dark:text-blue-400 mr-2">
          {formatTimestamp(segment.start)}
        </span>
            )}
            <span className="text-gray-800 dark:text-gray-200">{segment.text}</span>
        </button>
    );
}

export function BilingualView({
                                  originalSegments,
                                  translatedSegments,
                                  showTimestamps,
                                  onSeek,
                              }: BilingualViewProps): JSX.Element {
    const leftRef = useRef<HTMLDivElement>(null);
    const rightRef = useRef<HTMLDivElement>(null);
    const isScrollingSynced = useRef(false);
    const [mobileColumn, setMobileColumn] = useState<"original" | "translated">("original");

    const alignedRows = alignByTimestamp(originalSegments, translatedSegments);

    const handleSyncScroll = useCallback((source: "left" | "right") => {
        if (isScrollingSynced.current) return;
        isScrollingSynced.current = true;

        const sourceEl = source === "left" ? leftRef.current : rightRef.current;
        const targetEl = source === "left" ? rightRef.current : leftRef.current;

        if (sourceEl && targetEl) {
            targetEl.scrollTop = sourceEl.scrollTop;
        }

        requestAnimationFrame(() => {
            isScrollingSynced.current = false;
        });
    }, []);

    useEffect(() => {
        const leftEl = leftRef.current;
        const rightEl = rightRef.current;

        const onLeftScroll = (): void => handleSyncScroll("left");
        const onRightScroll = (): void => handleSyncScroll("right");

        leftEl?.addEventListener("scroll", onLeftScroll, {passive: true});
        rightEl?.addEventListener("scroll", onRightScroll, {passive: true});

        return () => {
            leftEl?.removeEventListener("scroll", onLeftScroll);
            rightEl?.removeEventListener("scroll", onRightScroll);
        };
    }, [handleSyncScroll]);

    return (
        <div className="flex flex-col gap-2" role="region" aria-label="Bilingual transcript view">
            {/* Translation quality banner */}
            <div
                className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg text-sm text-amber-800 dark:text-amber-200"
                role="status"
            >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                     aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <span>Translated by YouTube. Quality may vary.</span>
            </div>

            {/* Mobile toggle */}
            <div className="flex md:hidden border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <button
                    type="button"
                    onClick={() => setMobileColumn("original")}
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                        mobileColumn === "original"
                            ? "bg-blue-600 text-white"
                            : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                    }`}
                    aria-pressed={mobileColumn === "original"}
                >
                    Original
                </button>
                <button
                    type="button"
                    onClick={() => setMobileColumn("translated")}
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                        mobileColumn === "translated"
                            ? "bg-blue-600 text-white"
                            : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                    }`}
                    aria-pressed={mobileColumn === "translated"}
                >
                    Translated
                </button>
            </div>

            {/* Desktop: side-by-side columns */}
            <div className="hidden md:grid md:grid-cols-2 gap-4" aria-label="Side-by-side transcript">
                <div
                    ref={leftRef}
                    className="overflow-y-auto max-h-[70vh] border border-gray-200 dark:border-gray-700 rounded-lg p-2 space-y-1"
                    role="list"
                    aria-label="Original transcript"
                >
                    {alignedRows.map((row, i) => (
                        <div key={i} role="listitem">
                            <SegmentCell segment={row.original} showTime={showTimestamps} onSeek={onSeek}/>
                        </div>
                    ))}
                </div>
                <div
                    ref={rightRef}
                    className="overflow-y-auto max-h-[70vh] border border-gray-200 dark:border-gray-700 rounded-lg p-2 space-y-1"
                    role="list"
                    aria-label="Translated transcript"
                >
                    {alignedRows.map((row, i) => (
                        <div key={i} role="listitem">
                            <SegmentCell segment={row.translated} showTime={showTimestamps} onSeek={onSeek}/>
                        </div>
                    ))}
                </div>
            </div>

            {/* Mobile: single column with toggle */}
            <div
                className="md:hidden overflow-y-auto max-h-[70vh] border border-gray-200 dark:border-gray-700 rounded-lg p-2 space-y-1"
                role="list"
                aria-label={`${mobileColumn === "original" ? "Original" : "Translated"} transcript`}
            >
                {alignedRows.map((row, i) => (
                    <div key={i} role="listitem">
                        <SegmentCell
                            segment={mobileColumn === "original" ? row.original : row.translated}
                            showTime={showTimestamps}
                            onSeek={onSeek}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
