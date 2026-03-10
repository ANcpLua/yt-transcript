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

function escapeCsvField(value: string): string {
    if (value.includes('"') || value.includes(",") || value.includes("\n") || value.includes("\r")) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

export function generateCsv(segments: Segment[]): string {
    const rows: string[] = ["start_time,end_time,text"];

    for (const segment of segments) {
        const startTime = formatVttTime(segment.start);
        const endTime = formatVttTime(segment.start + segment.duration);
        const text = escapeCsvField(segment.text);
        rows.push(`${startTime},${endTime},${text}`);
    }

    return rows.join("\n");
}

export function exportCsv(
    segments: Segment[],
    title: string,
    language: string,
    filename?: string,
): void {
    const content = generateCsv(segments);
    const name = filename ?? sanitizeFilename(title, language, "csv");
    triggerDownload(content, name, "text/csv;charset=utf-8");
}
