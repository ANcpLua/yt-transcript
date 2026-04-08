import type { ApiError, Track, TranscriptResponse, Platform } from "@/types/transcript";

export interface FetchTranscriptOptions {
  lang?: string;
  translateTo?: string;
  pageData?: unknown;
}

export interface TranscriptProvider {
  platform: Platform;
  fetchTranscript(videoId: string, options?: FetchTranscriptOptions): Promise<TranscriptResponse | ApiError>;
  fetchTracks(videoId: string, pageData?: unknown): Promise<{ tracks: Track[]; title: string } | ApiError>;
}

export function isApiError(result: unknown): result is ApiError {
  return typeof result === "object" && result !== null && "error" in result;
}
