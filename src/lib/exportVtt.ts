import type {Segment} from "../types/transcript";
import {formatVttTime} from "./formatTime";
import {sanitizeFilename} from "./sanitizeFilename";

function triggerDownload(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], {type: mimeType});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function generateVtt(segments: Segment[]): string {
    const lines: string[] = ["WEBVTT", ""];

    for (const segment of segments) {
        const startTime = formatVttTime(segment.start);
        const endTime = formatVttTime(segment.start + segment.duration);
        lines.push(`${startTime} --> ${endTime}`);
        lines.push(segment.text);
        lines.push("");
    }

    return lines.join("\n");
}

export function exportVtt(
    segments: Segment[],
    title: string,
    language: string,
    filename?: string,
): void {
    const content = generateVtt(segments);
    const name = filename ?? sanitizeFilename(title, language, "vtt");
    triggerDownload(content, name, "text/vtt;charset=utf-8");
}
