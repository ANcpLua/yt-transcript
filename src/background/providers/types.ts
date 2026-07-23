import type { ApiError, TranscriptResponse, Platform } from "@/types/transcript";

export interface FetchTranscriptOptions {
  lang?: string;
  translateTo?: string;
  pageData?: unknown;
}

export interface TranscriptProvider {
  platform: Platform;
  fetchTranscript(videoId: string, options?: FetchTranscriptOptions): Promise<TranscriptResponse | ApiError>;
}

export function isApiError(result: unknown): result is ApiError {
  return typeof result === "object" && result !== null && "error" in result;
}
