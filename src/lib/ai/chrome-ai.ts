// Chrome built-in AI (Prompt API + Summarizer + Language Detector).
// Types not yet in @types/chrome; declared locally.

interface AiSummarizerCapabilities {
  available: "readily" | "after-download" | "no";
}

interface AiSummarizer {
  summarize(text: string): Promise<string>;
  destroy(): void;
}

interface AiSummarizerFactory {
  capabilities(): Promise<AiSummarizerCapabilities>;
  create(options?: { type?: string; length?: string }): Promise<AiSummarizer>;
}

interface AiNamespace {
  summarizer?: AiSummarizerFactory;
}

interface LanguageModelSession {
  prompt(text: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy?(): void;
  readonly inputQuota?: number;
  readonly inputUsage?: number;
  measureInputUsage?(text: string): Promise<number>;
}

interface LanguageModelExpectation {
  type: "text";
  languages?: string[];
}

interface LanguageModelStatic {
  availability(): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
  create(options?: {
    initialPrompts?: { role: "system" | "user" | "assistant"; content: string }[];
    temperature?: number;
    topK?: number;
    expectedInputs?: LanguageModelExpectation[];
    expectedOutputs?: LanguageModelExpectation[];
    // Newer Chrome field. Single ISO code; takes
    // precedence over expectedOutputs when supported.
    outputLanguage?: string;
  }): Promise<LanguageModelSession>;
}

function getAi(): AiNamespace | undefined {
  const s = self as unknown as { ai?: AiNamespace };
  return s.ai;
}

function getLanguageModel(): LanguageModelStatic | undefined {
  const w = globalThis as { LanguageModel?: LanguageModelStatic };
  return w.LanguageModel;
}

/** Prompt API (LanguageModel) — supports any prompt, all AI features. */
export async function isChromeAiPromptAvailable(): Promise<boolean> {
  const lm = getLanguageModel();
  if (!lm) return false;
  try {
    const status = await lm.availability();
    return status === "available" || status === "downloadable" || status === "downloading";
  } catch {
    return false;
  }
}

/** Legacy Summarizer API — only for the summary feature. */
export async function isChromeAiAvailable(): Promise<boolean> {
  if (await isChromeAiPromptAvailable()) return true;
  try {
    const ai = getAi();
    if (!ai?.summarizer) return false;
    const caps = await ai.summarizer.capabilities();
    return caps.available === "readily" || caps.available === "after-download";
  } catch {
    return false;
  }
}

// Chrome AI's session shares a single token budget between input AND output:
// inputQuota is the TOTAL, and as the model generates a response it consumes
// the same pool. If we hand the model an input that already uses 80% of quota,
// any non-trivial response throws "The response size exceeded the remaining
// available context" partway through generation.
//
// Split the budget: reserve half the quota (or at least MIN_RESPONSE_RESERVE
// tokens) for the response. The transcript trim only competes for the other
// half. This is conservative on input but eliminates the response-size error
// at the cost of slightly less context for the model to summarise.
const MIN_RESPONSE_RESERVE = 1_024;
const RESPONSE_RESERVE_RATIO = 0.5;
const DEFAULT_INPUT_QUOTA = 6_000;
const TRIM_MARKER = "\n\n[... transcript truncated for length ...]\n\n";

/** Binary head+tail trim of `trimmableContent` until the full assembled message fits within the session's input headroom. */
async function fitToQuota(
    session: LanguageModelSession,
    fixedPrefix: string,
    trimmableContent: string,
): Promise<string> {
    if (!session.measureInputUsage) return `${fixedPrefix}\n\n${trimmableContent}`;
    const quota = session.inputQuota ?? DEFAULT_INPUT_QUOTA;
    const used = session.inputUsage ?? 0;
    const reserve = Math.max(Math.floor(quota * RESPONSE_RESERVE_RATIO), MIN_RESPONSE_RESERVE);
    // Floor at 512 tokens so even a tiny quota leaves the model some room to think.
    const headroom = Math.max(quota - used - reserve, 512);

    const full = `${fixedPrefix}\n\n${trimmableContent}`;
    const fullUsage = await session.measureInputUsage(full);
    if (fullUsage <= headroom) return full;

    // Binary search the longest trim that still fits.
    let lo = 0;
    let hi = trimmableContent.length;
    let best = `${fixedPrefix}${TRIM_MARKER}`;
    while (hi - lo > 200) {
        const keep = Math.floor((lo + hi) / 2);
        const half = Math.floor(keep / 2);
        const candidate = `${fixedPrefix}\n\n${trimmableContent.slice(0, half)}${TRIM_MARKER}${trimmableContent.slice(-half)}`;
        const usage = await session.measureInputUsage(candidate);
        if (usage <= headroom) {
            best = candidate;
            lo = keep;
        } else {
            hi = keep;
        }
    }
    return best;
}

export interface ChromeAiPromptOptions {
    signal?: AbortSignal;
    /** When set, this content is appended to `userMessage` and is the only part trimmed if the session quota is exceeded. */
    trimmableContent?: string;
}

export async function runChromeAiPrompt(
  systemPrompt: string,
  userMessage: string,
  options: ChromeAiPromptOptions = {},
): Promise<string> {
  const lm = getLanguageModel();
  if (!lm) throw new Error("Chrome built-in AI (Prompt API) is not available in this Chrome profile.");
  const status = await lm.availability();
  if (status === "unavailable") throw new Error("Chrome built-in AI is unavailable on this device.");
  const session = await lm.create({
    initialPrompts: [{ role: "system", content: systemPrompt }],
    expectedInputs: [{ type: "text", languages: ["en", "es", "ja"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
    outputLanguage: "en",
  });
  try {
    const finalMessage = options.trimmableContent !== undefined
        ? await fitToQuota(session, userMessage, options.trimmableContent)
        : userMessage;
    return await session.prompt(finalMessage, options.signal ? { signal: options.signal } : undefined);
  } finally {
    session.destroy?.();
  }
}

export async function chromeAiSummarize(text: string): Promise<string> {
  // Prefer Prompt API when available — handles arbitrary content lengths.
  if (await isChromeAiPromptAvailable()) {
    return runChromeAiPrompt(
      "Summarize the following transcript into key points and a one-paragraph TLDR.",
      "Summarize the transcript below:",
      { trimmableContent: text },
    );
  }
  const ai = getAi();
  if (!ai?.summarizer) throw new Error("Chrome AI Summarizer not available");
  const caps = await ai.summarizer.capabilities();
  if (caps.available === "no") throw new Error("Summarizer not supported on this device");
  const summarizer = await ai.summarizer.create({ type: "key-points", length: "medium" });
  try {
    return await summarizer.summarize(text);
  } finally {
    summarizer.destroy();
  }
}
