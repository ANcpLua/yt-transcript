import type {Segment} from "../types/transcript";

interface FillerSet {
    /** Single-word fillers removed only when standalone or at clause start */
    standalone: string[];
    /** Multi-word fillers removed anywhere */
    phrases: string[];
}

const FILLERS: Record<string, FillerSet> = {
    en: {
        standalone: ["um", "uh", "er", "ah", "hmm"],
        phrases: [
            "you know",
            "I mean",
            "sort of",
            "kind of",
            "basically",
            "actually",
            "literally",
            "right?",
        ],
    },
    es: {
        standalone: ["este", "eh", "pues"],
        phrases: ["o sea", "en plan", "tipo"],
    },
    fr: {
        standalone: ["euh", "bah", "ben"],
        phrases: ["genre", "en fait", "du coup"],
    },
    de: {
        standalone: ["ähm", "äh"],
        phrases: ["halt", "sozusagen", "quasi", "irgendwie"],
    },
};

/**
 * Build a regex that matches a filler word only when it appears as a standalone word
 * at the start of a clause (beginning of string, after comma, after period, after dash).
 * Does NOT match mid-sentence usage like "I like dogs".
 */
function buildStandalonePattern(word: string): RegExp {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match at string start, after comma+space, after period+space, or after dash+space
    // Followed by comma, end-of-string, or whitespace
    return new RegExp(
        `(^|(?<=[,.!?;:\\-]\\s))${escaped}([,]?\\s+|$)`,
        "gi",
    );
}

/**
 * Build a regex for a multi-word phrase filler, matched with word boundaries.
 */
function buildPhrasePattern(phrase: string): RegExp {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // "right?" already contains ?, handle it as literal
    return new RegExp(`\\b${escaped}\\s*`, "gi");
}

/**
 * Handle "like" specially: only remove when it appears at clause start, not as a verb.
 * "Like, I was going" -> remove "Like,"
 * "I like dogs" -> keep "like"
 */
function buildLikePattern(): RegExp {
    // "like" followed by a comma (filler usage), at clause boundaries
    return new RegExp(
        `(^|(?<=[,.!?;:\\-]\\s))like,\\s*`,
        "gi",
    );
}

function cleanSegmentText(text: string, lang: string): string {
    const baseLanguage = (lang.split("-")[0] ?? lang).toLowerCase();
    const fillers = FILLERS[baseLanguage];

    if (!fillers) {
        return text;
    }

    let cleaned = text;

    // Apply phrase patterns first (longer matches take priority)
    for (const phrase of fillers.phrases) {
        const pattern = buildPhrasePattern(phrase);
        cleaned = cleaned.replace(pattern, " ");
    }

    // Apply standalone word patterns
    for (const word of fillers.standalone) {
        const pattern = buildStandalonePattern(word);
        cleaned = cleaned.replace(pattern, "$1");
    }

    // English-specific: handle "like" as filler
    if (baseLanguage === "en") {
        cleaned = cleaned.replace(buildLikePattern(), "$1");
    }

    // Collapse whitespace and trim
    cleaned = cleaned.replace(/\s{2,}/g, " ").trim();

    // Capitalize first letter if it was lowered by removal
    if (cleaned.length > 0 && /^[a-z]/.test(cleaned) && /^[A-Z]/.test(text)) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    return cleaned;
}

/**
 * Remove filler words from transcript segments.
 * Conservative approach: only removes fillers at clause boundaries, preserving
 * legitimate uses (e.g., "I like dogs" keeps "like").
 *
 * Supports English, Spanish, French, and German.
 */
export function removeFillersFromSegments(
    segments: Segment[],
    lang: string = "en",
): Segment[] {
    return segments
        .map((segment) => ({
            ...segment,
            text: cleanSegmentText(segment.text, lang),
        }))
        .filter((segment) => segment.text.length > 0);
}

// ---------- Profanity filter ----------

const PROFANITY_WORDS = [
    "fuck", "fucking", "fucked", "fucker", "fuckin",
    "shit", "shitty", "shitting",
    "bitch", "bitches",
    "ass", "asshole", "asses",
    "damn", "damned", "dammit",
    "bastard", "bastards",
    "dick", "dicks",
    "crap", "crappy",
    "hell",
    "piss", "pissed",
    "cunt",
    "whore",
    "slut",
    "cock",
    "bollocks",
    "wanker",
    "twat",
];

const PROFANITY_RE = new RegExp(
    `\\b(${PROFANITY_WORDS.join("|")})\\b`,
    "gi",
);

function censorWord(word: string): string {
    if (word.length <= 1) return "*";
    return word[0] + "*".repeat(word.length - 2) + word[word.length - 1]!;
}

export function filterProfanity(text: string): string {
    return text.replace(PROFANITY_RE, (match) => censorWord(match));
}

export function filterProfanityFromSegments(segments: Segment[]): Segment[] {
    return segments.map((segment) => ({
        ...segment,
        text: filterProfanity(segment.text),
    }));
}
