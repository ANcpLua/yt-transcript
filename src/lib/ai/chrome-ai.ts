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

interface AiLanguageDetector {
  detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>>;
  destroy(): void;
}

interface AiLanguageDetectorFactory {
  create(): Promise<AiLanguageDetector>;
}

interface AiNamespace {
  summarizer?: AiSummarizerFactory;
  languageDetector?: AiLanguageDetectorFactory;
}

interface LanguageModelSession {
  prompt(text: string): Promise<string>;
  destroy?(): void;
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

export async function runChromeAiPrompt(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const lm = getLanguageModel();
  if (!lm) throw new Error("Chrome built-in AI (Prompt API) is not available in this browser. Update to Edge/Chrome 138+ or enable chrome://flags/#prompt-api-for-gemini-nano.");
  const status = await lm.availability();
  if (status === "unavailable") throw new Error("Chrome built-in AI is unavailable on this device.");
  const session = await lm.create({
    initialPrompts: [{ role: "system", content: systemPrompt }],
    expectedInputs: [{ type: "text", languages: ["en", "es", "ja"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
  });
  try {
    return await session.prompt(userMessage);
  } finally {
    session.destroy?.();
  }
}

export async function chromeAiSummarize(text: string): Promise<string> {
  // Prefer Prompt API when available — handles arbitrary content lengths.
  if (await isChromeAiPromptAvailable()) {
    return runChromeAiPrompt(
      "Summarize the following transcript into key points and a one-paragraph TLDR.",
      text,
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

export async function chromeAiDetectLanguage(text: string): Promise<string | null> {
  const ai = getAi();
  if (!ai?.languageDetector) return null;
  const detector = await ai.languageDetector.create();
  try {
    const results = await detector.detect(text);
    return results[0]?.detectedLanguage ?? null;
  } finally {
    detector.destroy();
  }
}
