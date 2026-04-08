import type { TranscriptResponse, ApiError, Track, PlaylistResponse, ChannelResponse, Platform, Segment } from "./transcript";

// -- Content script -> Background --

export interface VideoDetectedMessage {
  type: "video-detected";
  videoId: string;
  platform: Platform;
}

export interface PlayerTimeMessage {
  type: "player-time";
  currentTime: number;
}

// -- Background -> Content script (request page data) --

export interface RequestPlayerDataMessage {
  type: "request-player-data";
  videoId: string;
}

export interface PlayerDataResponseMessage {
  type: "player-data-response";
  videoId: string;
  playerResponse: unknown | null;
}

// -- Side panel -> Background --

export interface FetchTranscriptMessage {
  type: "fetch-transcript";
  videoId: string;
  platform: Platform;
  lang?: string;
  translateTo?: string;
}

export interface FetchTracksMessage {
  type: "fetch-tracks";
  videoId: string;
  platform: Platform;
}

export interface FetchPlaylistMessage {
  type: "fetch-playlist";
  playlistId: string;
}

export interface FetchChannelMessage {
  type: "fetch-channel";
  identifier: string;
}

export interface AiRequestMessage {
  type: "ai-request";
  provider: string;
  apiKey: string;
  systemPrompt: string;
  userMessage: string;
}

export interface SeekToMessage {
  type: "seek-to";
  time: number;
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

export interface TracksResultMessage {
  type: "tracks-result";
  tracks: Track[];
  title: string;
}

export interface TracksErrorMessage {
  type: "tracks-error";
  error: ApiError;
}

export interface VideoInfoMessage {
  type: "video-info";
  videoId: string;
  platform: Platform;
}

// -- Transcription (Whisper local) --

export interface StartTranscriptionMessage {
  type: "start-transcription";
  videoId: string;
  title: string;
}

export interface StopTranscriptionMessage {
  type: "stop-transcription";
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
}

export interface CheckWhisperStatusMessage {
  type: "check-whisper-status";
}

export interface WhisperStatusMessage {
  type: "whisper-status";
  downloaded: boolean;
  modelId: string;
}

export interface DownloadWhisperMessage {
  type: "download-whisper";
  model: "tiny" | "base";
}

export interface DownloadWhisperProgressMessage {
  type: "download-whisper-progress";
  progress: number;
}

export interface DeleteWhisperMessage {
  type: "delete-whisper";
}

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

export interface AiResultMessage {
  type: "ai-result";
  content: string;
}

export interface AiErrorMessage {
  type: "ai-error";
  error: string;
}

// -- Union types --

export type ContentToBackgroundMessage =
  | VideoDetectedMessage
  | PlayerTimeMessage
  | PlayerDataResponseMessage;

export type PanelToBackgroundMessage =
  | FetchTranscriptMessage
  | FetchTracksMessage
  | FetchPlaylistMessage
  | FetchChannelMessage
  | AiRequestMessage
  | StartTranscriptionMessage
  | StopTranscriptionMessage
  | CheckWhisperStatusMessage
  | DownloadWhisperMessage
  | DeleteWhisperMessage;

export type BackgroundToPanelMessage =
  | TranscriptResultMessage
  | TranscriptErrorMessage
  | TracksResultMessage
  | TracksErrorMessage
  | VideoInfoMessage
  | PlaylistResultMessage
  | PlaylistErrorMessage
  | ChannelResultMessage
  | ChannelErrorMessage
  | AiResultMessage
  | AiErrorMessage
  | TranscriptionProgressMessage
  | TranscriptionCompleteMessage
  | TranscriptionErrorMessage
  | WhisperStatusMessage
  | DownloadWhisperProgressMessage;

export type BackgroundToContentMessage =
  | SeekToMessage
  | RequestPlayerDataMessage;

export type ExtensionMessage =
  | ContentToBackgroundMessage
  | PanelToBackgroundMessage
  | BackgroundToPanelMessage
  | BackgroundToContentMessage;
