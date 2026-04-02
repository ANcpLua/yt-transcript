// NOTE: fflate must be added to package.json — `npm install fflate`
import {strToU8, zipSync} from "fflate";
import type {TranscriptResponse} from "../../types/transcript";
import {sanitizeFilename} from "../sanitizeFilename";

export interface BatchItem {
    videoId: string;
    title?: string;
    status: "pending" | "processing" | "success" | "failed";
    result?: TranscriptResponse;
    error?: string;
}

export interface BatchState {
    items: BatchItem[];
    isProcessing: boolean;
    currentIndex: number;
    completedCount: number;
    failedCount: number;
}

export type BatchProgressCallback = (state: BatchState) => void;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildState(items: BatchItem[], isProcessing: boolean, currentIndex: number): BatchState {
    return {
        items: [...items],
        isProcessing,
        currentIndex,
        completedCount: items.filter((i) => i.status === "success").length,
        failedCount: items.filter((i) => i.status === "failed").length,
    };
}

async function fetchTranscript(videoId: string): Promise<TranscriptResponse> {
    return new Promise<TranscriptResponse>((resolve, reject) => {
        chrome.runtime.sendMessage(
            {type: "fetch-transcript", videoId},
            (response: { type: string; data?: TranscriptResponse; error?: { message: string } } | undefined) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message ?? "Extension error"));
                    return;
                }
                if (!response) {
                    reject(new Error("No response from background worker"));
                    return;
                }
                if (response.type === "transcript-result" && response.data) {
                    resolve(response.data);
                } else {
                    reject(new Error(response.error?.message ?? "Failed to fetch transcript"));
                }
            },
        );
    });
}

export class BatchProcessor {
    private items: BatchItem[] = [];
    private cancelled = false;
    private delayMs: number;

    constructor(delayMs: number = 1500) {
        this.delayMs = delayMs;
    }

    onProgress: BatchProgressCallback = () => {
    };

    start(videoIds: string[]): void {
        this.cancelled = false;
        this.items = videoIds.map((videoId) => ({
            videoId,
            status: "pending" as const,
        }));
        this.notify(-1, true);
        void this.process();
    }

    cancel(): void {
        this.cancelled = true;
    }

    retryFailed(): void {
        for (const item of this.items) {
            if (item.status === "failed") {
                item.status = "pending";
                item.error = undefined;
            }
        }
        this.cancelled = false;
        this.notify(-1, true);
        void this.process();
    }

    /** Download successful transcripts as individual files in a ZIP. */
    exportAsZip(items: BatchItem[], format: string): void {
        const files: Record<string, Uint8Array> = {};

        for (const item of items) {
            if (item.status !== "success" || !item.result) continue;
            const content = formatTranscript(item.result, format);
            const ext = formatToExtension(format);
            const name = sanitizeFilename(item.result.title, item.result.language, ext);
            files[name] = strToU8(content);
        }

        if (Object.keys(files).length === 0) return;

        const zipped = zipSync(files) as Uint8Array<ArrayBuffer>;
        triggerBlobDownload(zipped, "transcripts.zip", "application/zip");
    }

    /** Download all successful transcripts merged into one file. */
    exportMerged(items: BatchItem[], format: string): void {
        const parts: string[] = [];

        for (const item of items) {
            if (item.status !== "success" || !item.result) continue;
            parts.push(formatTranscript(item.result, format));
        }

        if (parts.length === 0) return;

        const separator = format === "json" ? ",\n" : "\n\n---\n\n";
        let content = parts.join(separator);
        if (format === "json") content = `[\n${content}\n]`;

        const ext = formatToExtension(format);
        triggerBlobDownload(
            strToU8(content) as Uint8Array<ArrayBuffer>,
            `transcripts_merged.${ext}`,
            "application/octet-stream",
        );
    }

    private notify(index: number, processing: boolean): void {
        this.onProgress(buildState(this.items, processing, index));
    }

    private async process(): Promise<void> {
        for (let i = 0; i < this.items.length; i++) {
            if (this.cancelled) {
                this.notify(i, false);
                return;
            }

            const item = this.items[i];
            if (!item || item.status !== "pending") continue;

            item.status = "processing";
            this.notify(i, true);

            try {
                const result = await fetchTranscript(item.videoId);
                item.status = "success";
                item.result = result;
                item.title = result.title;
            } catch (err: unknown) {
                item.status = "failed";
                item.error = err instanceof Error ? err.message : "Unknown error";
            }

            this.notify(i, true);

            // Rate-limit delay between requests (skip after last item)
            if (i < this.items.length - 1 && !this.cancelled) {
                await delay(this.delayMs);
            }
        }

        this.notify(this.items.length - 1, false);
    }
}

function formatToExtension(format: string): string {
    switch (format) {
        case "srt":
            return "srt";
        case "vtt":
            return "vtt";
        case "json":
            return "json";
        case "csv":
            return "csv";
        default:
            return "txt";
    }
}

function formatTranscript(response: TranscriptResponse, format: string): string {
    const {segments, title, videoId} = response;
    switch (format) {
        case "json":
            return JSON.stringify({videoId, title, segments}, null, 2);
        case "csv":
            return [
                "start,duration,text",
                ...segments.map((s) => `${s.start},${s.duration},"${s.text.replace(/"/g, '""')}"`),
            ].join("\n");
        case "srt":
            return segments
                .map((s, i) => `${i + 1}\n${fmtSrt(s.start)} --> ${fmtSrt(s.start + s.duration)}\n${s.text}`)
                .join("\n\n");
        case "vtt":
            return ["WEBVTT", "", ...segments.map(
                (s) => `${fmtVtt(s.start)} --> ${fmtVtt(s.start + s.duration)}\n${s.text}`,
            )].join("\n\n");
        default:
            return `${title}\n${"=".repeat(title.length)}\n\n` +
                segments.map((s) => `[${fmtTs(s.start)}] ${s.text}`).join("\n");
    }
}

function fmtTs(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtSrt(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.round((sec - Math.floor(sec)) * 1000);
    return `${p(h)}:${p(m)}:${p(s)},${String(ms).padStart(3, "0")}`;
}

function fmtVtt(sec: number): string {
    return fmtSrt(sec).replace(",", ".");
}

function p(n: number): string {
    return String(n).padStart(2, "0");
}

function triggerBlobDownload(data: Uint8Array<ArrayBuffer>, filename: string, mime: string): void {
    const blob = new Blob([data], {type: mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
