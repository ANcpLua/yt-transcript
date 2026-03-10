import type { Chapter } from "../types/transcript";

const TIMESTAMP_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+)/;

export function parseChapters(description: string): Chapter[] {
    if (!description) return [];

    const chapters: Chapter[] = [];
    const lines = description.split("\n");

    for (const line of lines) {
        const trimmed = line.trim();
        const match = TIMESTAMP_RE.exec(trimmed);
        if (!match) continue;

        const hours = match[1] ? parseInt(match[1], 10) : 0;
        const minutes = parseInt(match[2]!, 10);
        const seconds = parseInt(match[3]!, 10);
        const title = match[4]!.trim();

        if (title.length === 0) continue;

        chapters.push({
            title,
            start: hours * 3600 + minutes * 60 + seconds,
        });
    }

    // YouTube requires at least 3 chapters starting from 0:00 to show chapter markers
    if (chapters.length < 3) return [];
    if (chapters[0]?.start !== 0) return [];

    return chapters;
}
