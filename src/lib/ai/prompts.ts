import type {AiFeature} from "../../types/transcript";

interface PromptTemplate {
    system: string;
    user: (transcript: string, options?: unknown) => string;
}

const TOKEN_LIMIT = 100_000;
const CHARS_PER_TOKEN = 4;

export function truncateTranscript(transcript: string): string {
    const maxChars = TOKEN_LIMIT * CHARS_PER_TOKEN;
    if (transcript.length <= maxChars) return transcript;

    const keepPerSide = Math.floor(maxChars / 2);
    return (
        transcript.slice(0, keepPerSide) +
        "\n\n[... transcript truncated for length ...]\n\n" +
        transcript.slice(-keepPerSide)
    );
}

const BASE_SYSTEM =
    "You analyze YouTube video transcripts. Be concise and accurate. Use timestamps (MM:SS) when referencing specific moments.";

export const promptTemplates: Record<AiFeature, PromptTemplate> = {
    summary: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Provide a 3-5 sentence concise summary of this transcript:\n\n${truncateTranscript(t)}`,
    },
    bulletPoints: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Extract 5-10 key points as a bullet list from this transcript:\n\n${truncateTranscript(t)}`,
    },
    chapterSummary: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Identify the main sections/chapters in this transcript and summarize each with a heading and 1-2 sentences:\n\n${truncateTranscript(t)}`,
    },
    actionItems: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Extract all todos, recommendations, and next steps mentioned in this transcript as a checklist:\n\n${truncateTranscript(t)}`,
    },
    quotes: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Extract 3-7 notable or quotable passages from this transcript. Include the approximate timestamp for each:\n\n${truncateTranscript(t)}`,
    },
    blogOutline: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Create a structured blog post outline from this transcript with H2/H3 headings, intro, key sections, and conclusion:\n\n${truncateTranscript(t)}`,
    },
    socialPosts: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Write 3 social media post variants based on this transcript:\n1. Twitter (max 280 characters)\n2. LinkedIn (professional tone, 2-3 paragraphs)\n3. Instagram/TikTok (casual, short)\n\n${truncateTranscript(t)}`,
    },
    studyNotes: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Create study notes from this transcript: key terms with definitions, main concepts, and their relationships:\n\n${truncateTranscript(t)}`,
    },
    flashcards: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Generate 10-20 Q&A flashcard pairs from this transcript. Format each as:\nQ: [question]\nA: [answer]\n\n${truncateTranscript(t)}`,
    },
    seoKeywords: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Extract SEO keywords from this transcript grouped by: Primary (3-5), Secondary (5-10), Related/Long-tail (5-10):\n\n${truncateTranscript(t)}`,
    },
    entities: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Extract all named entities from this transcript: people, companies, tools/products, URLs, and locations. Include approximate timestamps:\n\n${truncateTranscript(t)}`,
    },
};

export function getChatSystemPrompt(transcriptText: string): string {
    return `${BASE_SYSTEM}\n\nHere is the transcript you should answer questions about:\n\n${truncateTranscript(transcriptText)}`;
}
