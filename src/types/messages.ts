import type { TranscriptResponse, ApiError, PlaylistResponse, ChannelResponse, Platform, Segment } from "./transcript";
import type {
  DiscoveryDiagnostics,
  DiscoveryResponse,
  DiscoveryTarget,
  MediaPlaybackState,
  PageDiscoverySnapshot,
  TimedTextResource,
} from "./discovery";

// -- Content script -> Background --

export interface PlayerTimeMessage {
  type: "player-time";
  currentTime: number;
}

export interface TimedTextPageSnapshotMessage {
  type: "timed-text-page-snapshot";
  snapshot: PageDiscoverySnapshot;
}

export interface TimedTextResourceMessage {
  type: "timed-text-resource";
  resource: TimedTextResource;
}

export interface MediaPlaybackStateMessage {
  type: "media-playback-state";
  state: MediaPlaybackState;
}

// -- ISOLATED-world bridge -> Background (intercepted YouTube responses) --

export type InterceptKind = "player" | "timedtext";

export interface InterceptedCaptureMessage {
  type: "intercepted-capture";
  kind: InterceptKind;
  videoId: string | null;
  url: string;
  status: number;
  bodyText: string;
}

// -- Side panel -> Background --

export interface FetchTranscriptMessage {
  type: "fetch-transcript";
  videoId: string;
  platform: Platform;
  lang?: string;
  translateTo?: string;
}

export interface FetchPlaylistMessage {
  type: "fetch-playlist";
  playlistId: string;
}

export interface FetchChannelMessage {
  type: "fetch-channel";
  identifier: string;
}

export interface SeekToMessage {
  type: "seek-to";
  time: number;
}

export interface DiscoverCurrentTabMessage {
  type: "discover-current-tab";
}

export interface RediscoverTabMessage {
  type: "rediscover-tab";
  tabId: number;
}

export interface PrepareUrlDiscoveryMessage {
  type: "prepare-url-discovery";
  url: string;
}

export interface GetDiscoveryStateMessage {
  type: "get-discovery-state";
}

export interface CancelPendingDiscoveryMessage {
  type: "cancel-pending-discovery";
  tabId: number;
}

export interface SelectDiscoveredTrackMessage {
  type: "select-discovered-track";
  videoId: string;
  trackId: string;
}

// -- Background -> Side panel --

export interface TranscriptResultMessage {
  type: "transcript-result";
  data: TranscriptResponse;
}

export interface TranscriptErrorMessage {
  type: "transcript-error";
  error: ApiError;
}

// Side-panel-side notification of a freshly intercepted transcript.
// Same payload shape as TranscriptResultMessage but distinct type so
// the side panel can decide whether to auto-load (idle) or show a
// "new transcript available" hint (already loaded different videoId).
export interface IntercepedTranscriptMessage {
  type: "intercepted-transcript";
  data: TranscriptResponse;
}

export interface DiscoveryStartedMessage extends DiscoveryTarget {
  type: "discovery-started";
}

export interface DiscoveryAwaitingActionMessage extends DiscoveryTarget {
  type: "discovery-awaiting-action";
}

export interface DiscoveryResultMessage {
  type: "discovery-result";
  target: DiscoveryTarget;
  data: TranscriptResponse;
  diagnostics: DiscoveryDiagnostics;
}

export interface DiscoveryEmptyMessage {
  type: "discovery-empty";
  target: DiscoveryTarget;
  diagnostics: DiscoveryDiagnostics;
  media: MediaPlaybackState | null;
}

export interface DiscoveryErrorMessage {
  type: "discovery-error";
  error: string;
  target?: DiscoveryTarget;
}

// -- On-device transcription --

export interface StartTranscriptionMessage {
  type: "start-transcription";
  videoId?: string;
  title?: string;
}

export interface GetTabTranscriptionStateMessage {
  type: "get-tab-transcription-state";
}

export interface CancelPendingTranscriptionMessage {
  type: "cancel-pending-transcription";
  tabId: number;
}

export interface StopTranscriptionMessage {
  type: "stop-transcription";
}

// Drag-and-drop / file-picker transcription. The side panel owns the File,
// mints a blob: URL for it (same chrome-extension:// origin as the offscreen
// document), and passes only the URL — File objects don't survive
// chrome.runtime message serialization.
export interface TranscribeFileMessage {
  type: "transcribe-file";
  blobUrl: string;
  videoId: string;
  title: string;
}

export interface TranscriptionProgressMessage {
  type: "transcription-progress";
  videoId: string;
  progress: number;
  segments: Segment[];
}

export interface TranscriptionCompleteMessage {
  type: "transcription-complete";
  videoId: string;
  title: string;
  segments: Segment[];
}

export interface TranscriptionErrorMessage {
  type: "transcription-error";
  error: string;
  videoId?: string;
}

export interface TabTranscriptionTarget {
  tabId: number;
  videoId: string;
  title: string;
  url: string;
}

export interface TranscriptionStartedMessage extends TabTranscriptionTarget {
  type: "transcription-started";
}

export interface TranscriptionAwaitingActionMessage extends TabTranscriptionTarget {
  type: "transcription-awaiting-action";
}

export type TabTranscriptionResponse =
  | ({ status: "started" } & TabTranscriptionTarget)
  | ({ status: "awaiting-action" } & TabTranscriptionTarget)
  | { status: "idle" }
  | { status: "error"; error: string };

export interface PlaylistResultMessage {
  type: "playlist-result";
  data: PlaylistResponse;
}

export interface PlaylistErrorMessage {
  type: "playlist-error";
  error: string;
}

export interface ChannelResultMessage {
  type: "channel-result";
  data: ChannelResponse;
}

export interface ChannelErrorMessage {
  type: "channel-error";
  error: string;
}

// -- Union types --

export type ContentToBackgroundMessage =
  | PlayerTimeMessage
  | TimedTextPageSnapshotMessage
  | TimedTextResourceMessage
  | MediaPlaybackStateMessage
  | InterceptedCaptureMessage;

export type PanelToBackgroundMessage =
  | FetchTranscriptMessage
  | FetchPlaylistMessage
  | FetchChannelMessage
  | DiscoverCurrentTabMessage
  | RediscoverTabMessage
  | PrepareUrlDiscoveryMessage
  | GetDiscoveryStateMessage
  | CancelPendingDiscoveryMessage
  | SelectDiscoveredTrackMessage
  | StartTranscriptionMessage
  | GetTabTranscriptionStateMessage
  | CancelPendingTranscriptionMessage
  | StopTranscriptionMessage
  | TranscribeFileMessage;

export type BackgroundToPanelMessage =
  | TranscriptResultMessage
  | TranscriptErrorMessage
  | IntercepedTranscriptMessage
  | DiscoveryStartedMessage
  | DiscoveryAwaitingActionMessage
  | DiscoveryResultMessage
  | DiscoveryEmptyMessage
  | DiscoveryErrorMessage
  | PlaylistResultMessage
  | PlaylistErrorMessage
  | ChannelResultMessage
  | ChannelErrorMessage
  | TranscriptionProgressMessage
  | TranscriptionCompleteMessage
  | TranscriptionErrorMessage
  | TranscriptionStartedMessage
  | TranscriptionAwaitingActionMessage
  | MediaPlaybackStateMessage;

export interface ScanTimedTextMessage {
  type: "scan-timed-text";
}

export type BackgroundToContentMessage =
  | SeekToMessage
  | ScanTimedTextMessage;

export type { DiscoveryResponse };

export type ExtensionMessage =
  | ContentToBackgroundMessage
  | PanelToBackgroundMessage
  | BackgroundToPanelMessage
  | BackgroundToContentMessage;
