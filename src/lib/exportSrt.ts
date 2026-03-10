import type {Segment} from "../types/transcript";
import {formatSrtTime} from "./formatTime";
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

export function generateSrt(segments: Segment[]): string {
    const blocks: string[] = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (!segment) continue;

        const index = i + 1;
        const startTime = formatSrtTime(segment.start);

        // End time: use segment's own end, but clamp to next segment's start if overlapping
        let endSeconds = segment.start + segment.duration;
        const nextSegment = segments[i + 1];
        if (nextSegment && endSeconds > nextSegment.start) {
            endSeconds = nextSegment.start;
        }
        const endTime = formatSrtTime(endSeconds);

        blocks.push(`${index}\n${startTime} --> ${endTime}\n${segment.text}`);
    }

    return blocks.join("\n\n") + "\n";
}

export function exportSrt(
    segments: Segment[],
    title: string,
    language: string,
): void {
    const content = generateSrt(segments);
    const filename = sanitizeFilename(title, language, "srt");
    triggerDownload(content, filename, "application/x-subrip;charset=utf-8");
}
