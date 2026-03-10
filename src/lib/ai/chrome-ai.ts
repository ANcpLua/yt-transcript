// Chrome AI types are not yet in @types/chrome, so we use self as unknown
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

function getAi(): AiNamespace | undefined {
  const s = self as unknown as { ai?: AiNamespace };
  return s.ai;
}

export async function isChromeAiAvailable(): Promise<boolean> {
  try {
    const ai = getAi();
    if (!ai?.summarizer) return false;
    const caps = await ai.summarizer.capabilities();
    return caps.available === "readily" || caps.available === "after-download";
  } catch {
    return false;
  }
}

export async function chromeAiSummarize(text: string): Promise<string> {
  const ai = getAi();
  if (!ai?.summarizer) throw new Error("Chrome AI Summarizer not available");

  const caps = await ai.summarizer.capabilities();
  if (caps.available === "no") throw new Error("Summarizer not supported on this device");

  const summarizer = await ai.summarizer.create({
    type: "key-points",
    length: "medium",
  });

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
