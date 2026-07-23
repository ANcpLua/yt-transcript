import type { Segment, TranscriptResponse } from "./transcript";
import type { TimedTextFormat } from "../lib/timed-text/detect";

export type TimedTextSource =
  | "runtime"
  | "track"
  | "fetch"
  | "xhr"
  | "performance"
  | "blob"
  | "data"
  | "manifest";

export interface MediaPlaybackState {
  mediaId: string;
  pageUrl: string;
  title: string;
  currentTime: number;
  duration: number | null;
  paused: boolean;
  ended: boolean;
  muted: boolean;
  volume: number;
  readyState: number;
}

export interface RuntimeTextTrackSnapshot {
  trackId: string;
  mediaId: string;
  language: string;
  label: string;
  kind: string;
  mode: TextTrackMode;
  sourceUrl?: string;
  cues: Segment[];
}

export interface TimedTextResource {
  url: string;
  mimeType: string;
  format: TimedTextFormat;
  source: TimedTextSource;
  bodyText?: string;
  language?: string;
  label?: string;
  kind?: string;
  trackId?: string;
  error?: string;
}

export interface PageDiscoverySnapshot {
  pageUrl: string;
  frameUrl: string;
  title: string;
  documentLanguage: string;
  media: MediaPlaybackState[];
  tracks: RuntimeTextTrackSnapshot[];
  requiredOrigins: string[];
}

export interface DiscoveryTarget {
  tabId: number;
  url: string;
  title: string;
}

export interface DiscoveryDiagnostics {
  candidateCount: number;
  detectedFormats: TimedTextFormat[];
  hasInBandCaptions: boolean;
  hasUnsupportedTimedText: boolean;
  requiredOrigins: string[];
}

export type DiscoveryResponse =
  | ({ status: "discovering" } & DiscoveryTarget)
  | ({ status: "awaiting-action" } & DiscoveryTarget)
  | {
      status: "found";
      target: DiscoveryTarget;
      data: TranscriptResponse;
      diagnostics: DiscoveryDiagnostics;
    }
  | {
      status: "empty";
      target: DiscoveryTarget;
      diagnostics: DiscoveryDiagnostics;
      media: MediaPlaybackState | null;
    }
  | { status: "idle" }
  | { status: "error"; error: string };
