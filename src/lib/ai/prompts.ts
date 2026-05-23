import type {AiFeature} from "../../types/transcript";

interface PromptTemplate {
    system: string;
    /** Instructions prepended to the transcript. The caller appends the transcript itself. */
    instructions: string;
}

// Static caps for providers we cannot ask about input size.
// Chrome AI uses session.measureInputUsage in chrome-ai.ts instead of these caps.
const STATIC_LIMITS = {
    ollama: 32_000,    // ~8K tokens, fits modern 7B-13B local models
    paid: 400_000,     // ~100K tokens, fits Claude / GPT-4o / Gemini
} as const;

export type ProviderKind = keyof typeof STATIC_LIMITS;

export function truncateForProvider(text: string, kind: ProviderKind): string {
    const cap = STATIC_LIMITS[kind];
    if (text.length <= cap) return text;
    const half = Math.floor(cap / 2);
    return text.slice(0, half) + "\n\n[... transcript truncated for length ...]\n\n" + text.slice(-half);
}

const BASE_SYSTEM =
    "You analyze YouTube video transcripts. Be brief. Prefer terse answers over thorough ones. " +
    "Use timestamps (MM:SS) only when referencing a specific moment. " +
    "If the transcript does not contain the information needed to answer, say so explicitly — " +
    "e.g. \"The transcript doesn't mention that.\" — instead of inventing an answer from related material.";

export const promptTemplates: Record<AiFeature, PromptTemplate> = {
    summary: {
        system: BASE_SYSTEM,
        instructions: "Write a 3-sentence summary of this transcript. Plain prose, no headings.",
    },
    bulletPoints: {
        system: BASE_SYSTEM,
        instructions: "List 5 key points from this transcript as short bullets. One line each. No nesting.",
    },
    qaExtract: {
        system: BASE_SYSTEM,
        instructions:
            "Extract 5 direct Q&A pairs from this transcript. Format each as a markdown bold label:\n\n**Q:** question\n**A:** answer (timestamp)\n\nKeep each answer to one short sentence. No preamble, no closing remarks.",
    },
};

/** Compose a one-shot user message for providers that take a single string (Ollama, paid). */
export function buildUserMessage(template: PromptTemplate, transcript: string): string {
    return `${template.instructions}\n\n${transcript}`;
}

export function getChatSystemPrompt(transcriptText: string): string {
    return `${BASE_SYSTEM}\n\nHere is the transcript you should answer questions about:\n\n${transcriptText}`;
}

/**
 * Chrome AI chat splits transcript out of system prompt so it can be measured/trimmed
 * by session.measureInputUsage. The static-cap providers (Ollama, paid) keep
 * getChatSystemPrompt with the transcript baked in.
 */
export const CHAT_BASE_SYSTEM = BASE_SYSTEM;
