import type {Chapter, ParagraphSegment, Segment} from "../types/transcript";
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
    videoId: string;
    language: string;
    segments: Segment[];
    paragraphs?: ParagraphSegment[];
    chapters?: Chapter[];
    bilingualSegments?: Segment[];
    bilingualLanguage?: string;
    format?: MarkdownFormat;
    obsidianTags?: string[];
}

function timestampedLine(segment: Segment): string {
    return `**[${formatTimestamp(segment.start)}]** ${segment.text}`;
}

function notionTimestampedLine(segment: Segment): string {
    return `\`${formatTimestamp(segment.start)}\` ${segment.text}`;
}

function renderBilingualTable(
    original: Segment[],
    translated: Segment[],
    originalLang: string,
    translatedLang: string,
): string {
    const lines: string[] = [
        `| ${originalLang} | ${translatedLang} |`,
        "| --- | --- |",
    ];

    const maxLen = Math.max(original.length, translated.length);
    for (let i = 0; i < maxLen; i++) {
        const orig = original[i];
        const trans = translated[i];
        const origCell = orig
            ? `**[${formatTimestamp(orig.start)}]** ${orig.text}`
            : "";
        const transCell = trans?.text ?? "";
        lines.push(`| ${origCell} | ${transCell} |`);
    }

    return lines.join("\n");
}

function renderBilingualAlternating(
    original: Segment[],
    translated: Segment[],
): string {
    const lines: string[] = [];
    const maxLen = Math.max(original.length, translated.length);

    for (let i = 0; i < maxLen; i++) {
        const orig = original[i];
        const trans = translated[i];
        if (orig) {
            lines.push(timestampedLine(orig));
        }
        if (trans) {
            lines.push(`> ${trans.text}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}

/** Render segments with optional chapter headings, using a per-line formatter. */
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
    const {title, videoId, language, segments, paragraphs, chapters, bilingualSegments, bilingualLanguage} = options;
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    const lines: string[] = [
        `# ${title}`, "",
        `**Source:** ${url}`,
        `**Language:** ${language}`,
        `**Extracted:** ${formatDate()}`, "",
        "---", "",
    ];

    if (bilingualSegments && bilingualLanguage) {
        lines.push(renderBilingualTable(segments, bilingualSegments, language, bilingualLanguage), "");
        return lines.join("\n");
    }

    lines.push(...renderBody(paragraphs ?? segments, chapters, timestampedLine));
    return lines.join("\n");
}

function generateNotion(options: ExportMarkdownOptions): string {
    const {title, videoId, language, segments, chapters, bilingualSegments, bilingualLanguage} = options;
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    const lines: string[] = [
        `# ${title}`, "",
        `> **Source:** ${url}`,
        `> **Language:** ${language}`,
        `> **Extracted:** ${formatDate()}`, "",
    ];

    if (bilingualSegments && bilingualLanguage) {
        lines.push(renderBilingualAlternating(segments, bilingualSegments));
        return lines.join("\n");
    }

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
    const {
        title,
        videoId,
        language,
        segments,
        paragraphs,
        chapters,
        bilingualSegments,
        bilingualLanguage,
        obsidianTags
    } = options;
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const tags = obsidianTags ?? ["youtube", "transcript"];

    const lines: string[] = [
        "---",
        `title: "${title.replace(/"/g, '\\"')}"`,
        `source: "${url}"`,
        `language: "${language}"`,
        `date: "${formatDate()}"`,
        `tags: [${tags.map((t) => `"${t}"`).join(", ")}]`,
        "---", "",
        `# ${title}`, "",
    ];

    if (bilingualSegments && bilingualLanguage) {
        lines.push(renderBilingualTable(segments, bilingualSegments, language, bilingualLanguage), "");
        return lines.join("\n");
    }

    lines.push(...renderBody(paragraphs ?? segments, chapters, timestampedLine));
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
