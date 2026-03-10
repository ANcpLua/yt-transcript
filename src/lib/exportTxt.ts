import type {Segment} from "../types/transcript";
import {formatTimestamp} from "./formatTime";
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

export function generateTxt(segments: Segment[], showTimestamps: boolean): string {
    return segments
        .map((s) => {
            const prefix = showTimestamps ? `[${formatTimestamp(s.start)}] ` : "";
            return `${prefix}${s.text}`;
        })
        .join("\n");
}

export function exportTxt(
    segments: Segment[],
    title: string,
    language: string,
    showTimestamps: boolean,
): void {
    const content = generateTxt(segments, showTimestamps);
    const filename = sanitizeFilename(title, language, "txt");
    triggerDownload(content, filename, "text/plain;charset=utf-8");
}
