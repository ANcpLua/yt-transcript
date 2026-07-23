import type {Chapter, Segment} from "../types/transcript";
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

function formatTimestamp(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatDate(): string {
    return new Date().toISOString().split("T")[0] ?? "";
}

function segmentsInChapter(
    segments: Segment[],
    chapterStart: number,
    nextChapterStart: number | undefined,
): Segment[] {
    return segments.filter((s) =>
        nextChapterStart !== undefined
            ? s.start >= chapterStart && s.start < nextChapterStart
            : s.start >= chapterStart,
    );
}

type MarkdownFormat = "standard" | "notion" | "obsidian";

interface ExportMarkdownOptions {
    title: string;
    language: string;
    segments: Segment[];
    chapters?: Chapter[];
    sourceUrl?: string;
    format?: MarkdownFormat;
}

function timestampedLine(segment: Segment): string {
    return `**[${formatTimestamp(segment.start)}]** ${segment.text}`;
}

function notionTimestampedLine(segment: Segment): string {
    return `\`${formatTimestamp(segment.start)}\` ${segment.text}`;
}

function renderBody(
    items: Segment[],
    chapters: Chapter[] | undefined,
    formatLine: (segment: Segment) => string,
): string[] {
    const lines: string[] = [];

    if (chapters && chapters.length > 0) {
        for (let ci = 0; ci < chapters.length; ci++) {
            const chapter = chapters[ci];
            if (!chapter) continue;
            const nextChapter = chapters[ci + 1];
            lines.push(`## ${chapter.title}`, "");

            for (const item of segmentsInChapter(items, chapter.start, nextChapter?.start)) {
                lines.push(formatLine(item), "");
            }
        }
    } else {
        for (const item of items) {
            lines.push(formatLine(item), "");
        }
    }

    return lines;
}

function generateStandard(options: ExportMarkdownOptions): string {
    const {title, language, segments, chapters, sourceUrl} = options;

    const lines: string[] = [
        `# ${title}`, "",
        ...(sourceUrl ? [`**Source:** ${sourceUrl}`] : []),
        `**Language:** ${language}`,
        `**Extracted:** ${formatDate()}`, "",
        "---", "",
    ];

    lines.push(...renderBody(segments, chapters, timestampedLine));
    return lines.join("\n");
}

function generateNotion(options: ExportMarkdownOptions): string {
    const {title, language, segments, chapters, sourceUrl} = options;

    const lines: string[] = [
        `# ${title}`, "",
        ...(sourceUrl ? [`> **Source:** ${sourceUrl}`] : []),
        `> **Language:** ${language}`,
        `> **Extracted:** ${formatDate()}`, "",
    ];

    if (chapters && chapters.length > 0) {
        for (let ci = 0; ci < chapters.length; ci++) {
            const chapter = chapters[ci];
            if (!chapter) continue;
            const nextChapter = chapters[ci + 1];

            lines.push("<details>", `<summary>${chapter.title}</summary>`, "");
            for (const segment of segmentsInChapter(segments, chapter.start, nextChapter?.start)) {
                lines.push(notionTimestampedLine(segment), "");
            }
            lines.push("</details>", "");
        }
    } else {
        for (const segment of segments) {
            lines.push(notionTimestampedLine(segment), "");
        }
    }

    return lines.join("\n");
}

function generateObsidian(options: ExportMarkdownOptions): string {
    const {title, language, segments, chapters, sourceUrl} = options;

    const lines: string[] = [
        "---",
        `title: "${title.replace(/"/g, '\\"')}"`,
        ...(sourceUrl ? [`source: "${sourceUrl.replace(/"/g, '\\"')}"`] : []),
        `language: "${language}"`,
        `date: "${formatDate()}"`,
        'tags: ["transcript"]',
        "---", "",
        `# ${title}`, "",
    ];

    lines.push(...renderBody(segments, chapters, timestampedLine));
    return lines.join("\n");
}

export function generateMarkdown(options: ExportMarkdownOptions): string {
    switch (options.format) {
        case "notion":
            return generateNotion(options);
        case "obsidian":
            return generateObsidian(options);
        default:
            return generateStandard(options);
    }
}

export function exportMarkdown(options: ExportMarkdownOptions, filename?: string): void {
    const content = generateMarkdown(options);
    const formatSuffix = options.format && options.format !== "standard" ? `_${options.format}` : "";
    const ext = `${formatSuffix}.md`.replace(/^\./, "");
    const name = filename ?? sanitizeFilename(options.title, options.language, ext);
    triggerDownload(content, name, "text/markdown;charset=utf-8");
}
