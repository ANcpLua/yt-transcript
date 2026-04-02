import type { TranscriptResponse, ApiError, Track, PlaylistResponse, ChannelResponse } from "./transcript";

// -- Content script -> Background --

export interface VideoDetectedMessage {
  type: "video-detected";
  videoId: string;
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
  lang?: string;
  translateTo?: string;
}

export interface FetchTracksMessage {
  type: "fetch-tracks";
  videoId: string;
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
  | AiRequestMessage;

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
  | AiErrorMessage;

export type BackgroundToContentMessage =
  | SeekToMessage
  | RequestPlayerDataMessage;

export type ExtensionMessage =
  | ContentToBackgroundMessage
  | PanelToBackgroundMessage
  | BackgroundToPanelMessage
  | BackgroundToContentMessage;
