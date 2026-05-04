import type { ApiError, Track, TranscriptResponse } from "@/types/transcript";
import type { FetchTranscriptOptions, TranscriptProvider } from "./types";
import { fetchTranscript, fetchTracks } from "../innertube";

export class YouTubeProvider implements TranscriptProvider {
  readonly platform = "youtube" as const;

  async fetchTranscript(
    videoId: string,
    options?: FetchTranscriptOptions,
  ): Promise<TranscriptResponse | ApiError> {
    return fetchTranscript(videoId, options?.lang, options?.translateTo);
  }

  async fetchTracks(
    videoId: string,
  ): Promise<{ tracks: Track[]; title: string } | ApiError> {
    return fetchTracks(videoId);
  }
}
