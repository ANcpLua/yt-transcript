import type { ApiError, TranscriptResponse } from "@/types/transcript";
import type { FetchTranscriptOptions, TranscriptProvider } from "./types";
import { fetchTranscript } from "../innertube";

export class YouTubeProvider implements TranscriptProvider {
  readonly platform = "youtube" as const;

  async fetchTranscript(
    videoId: string,
    options?: FetchTranscriptOptions,
  ): Promise<TranscriptResponse | ApiError> {
    return fetchTranscript(videoId, options?.lang, options?.translateTo);
  }
}
