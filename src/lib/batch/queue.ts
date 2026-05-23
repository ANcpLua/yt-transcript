import {strToU8, zipSync} from "fflate";
import type {TranscriptResponse} from "../../types/transcript";
import {sanitizeFilename} from "../sanitizeFilename";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_DELAY_MS = 0;

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
    activeCount: number;
    concurrency: number;
}

export type BatchProgressCallback = (state: BatchState) => void;

export interface BatchProcessorOptions {
    concurrency?: number;
    delayMs?: number;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampConcurrency(value: number | undefined): number {
    if (!Number.isFinite(value)) return DEFAULT_CONCURRENCY;
    return Math.max(1, Math.min(8, Math.floor(value ?? DEFAULT_CONCURRENCY)));
}

function buildState(
    items: BatchItem[],
    isProcessing: boolean,
    currentIndex: number,
    concurrency: number,
): BatchState {
    return {
        items: [...items],
        isProcessing,
        currentIndex,
        completedCount: items.filter((i) => i.status === "success").length,
        failedCount: items.filter((i) => i.status === "failed").length,
        activeCount: items.filter((i) => i.status === "processing").length,
        concurrency,
    };
}

async function fetchTranscript(videoId: string): Promise<TranscriptResponse> {
    return new Promise<TranscriptResponse>((resolve, reject) => {
        chrome.runtime.sendMessage(
            {type: "fetch-transcript", videoId, platform: "youtube"},
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
    private runId = 0;
    private delayMs: number;
    private concurrency: number;

    constructor(options: BatchProcessorOptions | number = {}) {
        const opts = typeof options === "number" ? {delayMs: options} : options;
        this.delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;
        this.concurrency = clampConcurrency(opts.concurrency);
    }

    onProgress: BatchProgressCallback = () => {
    };

    start(videoIds: string[]): void {
        this.runId += 1;
        this.cancelled = false;
        this.items = videoIds.map((videoId) => ({
            videoId,
            status: "pending" as const,
        }));
        this.notify(-1, true);
        void this.process(this.runId);
    }

    cancel(): void {
        this.cancelled = true;
        this.runId += 1;
        for (const item of this.items) {
            if (item.status === "processing") item.status = "pending";
        }
        this.notify(-1, false);
    }

    retryFailed(): void {
        for (const item of this.items) {
            if (item.status === "failed") {
                item.status = "pending";
                item.error = undefined;
            }
        }
        this.runId += 1;
        this.cancelled = false;
        this.notify(-1, true);
        void this.process(this.runId);
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
        this.onProgress(buildState(this.items, processing, index, this.concurrency));
    }

    private async process(runId: number): Promise<void> {
        const workerCount = Math.min(
            this.concurrency,
            this.items.filter((item) => item.status === "pending").length,
        );
        if (workerCount === 0) {
            this.notify(-1, false);
            return;
        }

        await Promise.all(Array.from(
            {length: workerCount},
            () => this.processWorker(runId),
        ));

        if (runId === this.runId && !this.cancelled) {
            this.notify(this.items.length - 1, false);
        }
    }

    private takeNextPending(): { item: BatchItem; index: number } | null {
        const index = this.items.findIndex((item) => item.status === "pending");
        if (index < 0) return null;
        const item = this.items[index];
        if (!item) return null;
        item.status = "processing";
        return {item, index};
    }

    private hasPending(): boolean {
        return this.items.some((item) => item.status === "pending");
    }

    private async processWorker(runId: number): Promise<void> {
        while (runId === this.runId && !this.cancelled) {
            const next = this.takeNextPending();
            if (!next) return;

            const {item, index} = next;
            this.notify(index, true);

            try {
                const result = await fetchTranscript(item.videoId);
                if (runId !== this.runId || this.cancelled) return;
                item.status = "success";
                item.result = result;
                item.title = result.title;
            } catch (err: unknown) {
                if (runId !== this.runId || this.cancelled) return;
                item.status = "failed";
                item.error = err instanceof Error ? err.message : "Unknown error";
            }

            this.notify(index, true);

            if (this.delayMs > 0 && this.hasPending() && runId === this.runId && !this.cancelled) {
                await delay(this.delayMs);
            }
        }
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
