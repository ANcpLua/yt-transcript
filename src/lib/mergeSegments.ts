import type {ParagraphSegment, Segment} from "../types/transcript";

const SENTENCE_ENDINGS = /[.!?]\s*$/;
const PAUSE_THRESHOLD = 1.5;
const MAX_PARAGRAPH_WORDS = 200;

function wordCount(text: string): number {
    return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function segmentEnd(segment: Segment): number {
    return segment.start + segment.duration;
}

function flushBuffer(buffer: Segment[], text: string): ParagraphSegment | undefined {
    const first = buffer[0];
    const last = buffer[buffer.length - 1];
    if (!first || !last) return undefined;

    return {
        start: first.start,
        duration: segmentEnd(last) - first.start,
        text: text.trim(),
        originalSegments: [...buffer],
    };
}

export function mergeIntoParagraphs(segments: Segment[]): ParagraphSegment[] {
    const first = segments[0];
    if (!first) return [];

    const paragraphs: ParagraphSegment[] = [];
    let currentSegments: Segment[] = [first];
    let currentText = first.text;

    for (let i = 1; i < segments.length; i++) {
        const prev = segments[i - 1];
        const curr = segments[i];
        if (!prev || !curr) continue;

        const pause = curr.start - segmentEnd(prev);
        const endsWithSentence = SENTENCE_ENDINGS.test(currentText);
        const tooManyWords = wordCount(currentText + " " + curr.text) > MAX_PARAGRAPH_WORDS;

        if (pause > PAUSE_THRESHOLD || endsWithSentence || tooManyWords) {
            const flushed = flushBuffer(currentSegments, currentText);
            if (flushed) paragraphs.push(flushed);
            currentSegments = [curr];
            currentText = curr.text;
        } else {
            currentSegments.push(curr);
            currentText += " " + curr.text;
        }
    }

    const flushed = flushBuffer(currentSegments, currentText);
    if (flushed) paragraphs.push(flushed);

    return paragraphs;
}

export function mergeIntoSentences(segments: Segment[]): Segment[] {
    const first = segments[0];
    if (!first) return [];

    const sentences: Segment[] = [];
    let accSegments: Segment[] = [first];
    let accText = first.text;

    for (let i = 1; i < segments.length; i++) {
        const curr = segments[i];
        if (!curr) continue;

        if (SENTENCE_ENDINGS.test(accText)) {
            const accFirst = accSegments[0];
            const accLast = accSegments[accSegments.length - 1];
            if (accFirst && accLast) {
                sentences.push({
                    start: accFirst.start,
                    duration: segmentEnd(accLast) - accFirst.start,
                    text: accText.trim(),
                });
            }
            accSegments = [curr];
            accText = curr.text;
        } else {
            accSegments.push(curr);
            accText += " " + curr.text;
        }
    }

    const accFirst = accSegments[0];
    const accLast = accSegments[accSegments.length - 1];
    if (accFirst && accLast) {
        sentences.push({
            start: accFirst.start,
            duration: segmentEnd(accLast) - accFirst.start,
            text: accText.trim(),
        });
    }

    return sentences;
}
