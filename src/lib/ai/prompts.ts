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
    sentiment: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Analyze the sentiment and emotional arc of this transcript. Include:\n1. Overall tone (positive/negative/neutral/mixed)\n2. Emotional arc — how the tone shifts throughout\n3. Any detected bias or persuasion techniques\n4. Key emotional moments with timestamps\n\n${truncateTranscript(t)}`,
    },
    topics: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Extract the main topics and themes from this transcript. Provide:\n1. Primary topics (3-5) with brief descriptions\n2. Secondary topics (5-10)\n3. Suggested hashtags (10-15, formatted as #hashtag)\n4. One-line topic summary\n\n${truncateTranscript(t)}`,
    },
    qaExtract: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Find direct answers to common questions within this transcript. For each, provide:\n- The implicit or explicit question being answered\n- The direct answer from the transcript\n- The approximate timestamp\n\nExtract 5-15 Q&A pairs. Focus on factual, actionable answers.\n\n${truncateTranscript(t)}`,
    },
    mindmap: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Create a mermaid mindmap diagram representing the key concepts and their relationships from this transcript. Use this exact format:\n\n\`\`\`mermaid\nmindmap\n  root((Main Topic))\n    Branch 1\n      Sub-topic\n      Sub-topic\n    Branch 2\n      Sub-topic\n\`\`\`\n\nInclude 3-6 main branches with 2-4 sub-topics each. Output ONLY the mermaid code block.\n\n${truncateTranscript(t)}`,
    },
    studyGuide: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Create a comprehensive study guide from this transcript with:\n1. **Learning Objectives** — what you should know after studying\n2. **Key Concepts** — definitions and explanations\n3. **Detailed Notes** — organized by section with timestamps\n4. **Summary** — 3-5 sentence recap\n5. **Review Questions** — 5 questions to test understanding\n\n${truncateTranscript(t)}`,
    },
    qaGenerate: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Generate 10-15 question-answer pairs for review based on this transcript. Include a mix of:\n- Factual recall questions\n- Conceptual understanding questions\n- Application questions\n\nFormat each as:\n**Q:** [question]\n**A:** [answer]\n\n${truncateTranscript(t)}`,
    },
    quiz: {
        system: BASE_SYSTEM,
        user: (t) =>
            `Generate a 10-question multiple-choice quiz based on this transcript. For each question:\n- Provide 4 options labeled A, B, C, D\n- Mark the correct answer with ✓\n- Include a brief explanation for the correct answer\n\nFormat:\n**1. [Question]**\nA) [option]\nB) [option]\nC) [option] ✓\nD) [option]\n*Explanation: [why C is correct]*\n\n${truncateTranscript(t)}`,
    },
};

export function getChatSystemPrompt(transcriptText: string): string {
    return `${BASE_SYSTEM}\n\nHere is the transcript you should answer questions about:\n\n${truncateTranscript(transcriptText)}`;
}
