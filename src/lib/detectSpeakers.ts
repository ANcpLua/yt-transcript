import type {Segment} from "../types/transcript";

export interface SegmentWithSpeaker extends Segment {
    speaker?: string;
}

const BRACKET_RE = /^\[([^\]]+)\]:?\s*/;
const CHEVRON_RE = /^>>\s*/;
const CAPS_LABEL_RE = /^([A-Z][A-Z0-9\s]{0,30}[A-Z0-9]):\s*/;
const NAME_RE = /^([A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*){0,3}):\s*/;

const IGNORE = new Set([
    "The", "This", "That", "Here", "There",
    "What", "When", "Where", "Which", "Who", "How", "Why",
    "But", "And", "Note", "Example", "Chapter", "Step", "Question", "Answer",
]);

interface ParseResult {
    speaker: string | null;
    text: string
}

function tryNameLabel(text: string): ParseResult {
    const caps = CAPS_LABEL_RE.exec(text);
    if (caps?.[1]) return {speaker: caps[1].trim(), text: text.slice(caps[0].length)};

    const name = NAME_RE.exec(text);
    if (name?.[1] && !IGNORE.has(name[1].trim())) {
        return {speaker: name[1].trim(), text: text.slice(name[0].length)};
    }

    return {speaker: null, text};
}

function parseSpeaker(text: string): ParseResult {
    const bracket = BRACKET_RE.exec(text);
    if (bracket?.[1]) return {speaker: bracket[1].trim(), text: text.slice(bracket[0].length)};

    const chevron = CHEVRON_RE.exec(text);
    if (chevron) {
        const after = text.slice(chevron[0].length);
        const inner = tryNameLabel(after);
        return inner.speaker ? inner : {speaker: null, text: after};
    }

    return tryNameLabel(text);
}

/**
 * Detect speakers in transcript segments by parsing labels from text.
 * Recognizes `[Name]:`, `NAME:`, `Name:`, and `>>` patterns.
 * Propagates the last-seen speaker to unlabeled segments.
 */
export function detectSpeakers(segments: Segment[]): SegmentWithSpeaker[] {
    if (segments.length === 0) return [];

    let anyFound = false;
    const parsed = segments.map((seg) => {
        const r = parseSpeaker(seg.text);
        if (r.speaker) anyFound = true;
        return {seg, r};
    });

    if (!anyFound) return segments.map((s) => ({...s, speaker: undefined}));

    let current: string | undefined;
    let counter = 0;

    return parsed.map(({seg, r}) => {
        if (r.speaker) {
            current = r.speaker;
            return {...seg, text: r.text || seg.text, speaker: current};
        }
        if (CHEVRON_RE.test(seg.text)) {
            counter += 1;
            current = `Speaker ${counter}`;
            return {...seg, text: r.text, speaker: current};
        }
        return {...seg, speaker: current};
    });
}

/** Unique speaker names in order of first appearance. */
export function getUniqueSpeakers(segments: SegmentWithSpeaker[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of segments) {
        if (s.speaker && !seen.has(s.speaker)) {
            seen.add(s.speaker);
            result.push(s.speaker);
        }
    }
    return result;
}

/** Filter segments to a specific speaker. */
export function filterBySpeaker(
    segments: SegmentWithSpeaker[],
    speaker: string,
): SegmentWithSpeaker[] {
    return segments.filter((s) => s.speaker === speaker);
}
