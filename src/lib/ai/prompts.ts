import type {AiFeature} from "../../types/transcript";

interface PromptTemplate {
    system: string;
    /** Instructions prepended to the transcript. The caller appends the transcript itself. */
    instructions: string;
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

/**
 * Chrome AI chat splits transcript out of system prompt so it can be measured/trimmed
 * by session.measureInputUsage.
 */
export const CHAT_BASE_SYSTEM = BASE_SYSTEM;
