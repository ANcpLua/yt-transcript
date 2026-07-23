import type {
  MediaPlaybackState,
  PageDiscoverySnapshot,
  RuntimeTextTrackSnapshot,
  TimedTextResource,
} from "../types/discovery";
import type { Segment } from "../types/transcript";

export {};

const CAPTURE_EVENT = "video-transcript-resource";
const globalState = globalThis as typeof globalThis & {
  __videoTranscriptBridgeInstalled?: boolean;
};
const mediaIds = new WeakMap<HTMLMediaElement, string>();
const trackIds = new WeakMap<TextTrack, string>();
const observedMedia = new WeakSet<HTMLMediaElement>();
const observedTracks = new WeakSet<TextTrack>();
let sequence = 0;
let scanTimer: ReturnType<typeof setTimeout> | null = null;

function nextId(prefix: string): string {
  sequence++;
  return `${prefix}-${sequence}`;
}

function safeSend(message: unknown): void {
  if (!chrome.runtime?.id) return;
  try {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    if (error instanceof Error && !/Extension context invalidated/i.test(error.message)) {
      throw error;
    }
  }
}

function mediaIdFor(media: HTMLMediaElement): string {
  const existing = mediaIds.get(media);
  if (existing) return existing;
  const id = nextId("media");
  mediaIds.set(media, id);
  return id;
}

function trackIdFor(track: TextTrack): string {
  const existing = trackIds.get(track);
  if (existing) return existing;
  const id = nextId("track");
  trackIds.set(track, id);
  return id;
}

function cueText(cue: TextTrackCue): string {
  const textCue = cue as TextTrackCue & { text?: unknown };
  if (typeof textCue.text === "string") return textCue.text;
  const htmlCue = cue as TextTrackCue & { getCueAsHTML?: () => DocumentFragment };
  if (typeof htmlCue.getCueAsHTML === "function") {
    return htmlCue.getCueAsHTML().textContent ?? "";
  }
  return "";
}

function cuesFor(track: TextTrack): Segment[] {
  const cues = track.cues;
  if (!cues) return [];
  const segments: Segment[] = [];
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index];
    if (!cue) continue;
    const text = cueText(cue).trim();
    if (!text) continue;
    segments.push({
      start: cue.startTime,
      duration: Math.max(0, cue.endTime - cue.startTime),
      text,
    });
  }
  return segments;
}

function sourceForTrack(media: HTMLMediaElement, track: TextTrack): string | undefined {
  for (const element of media.querySelectorAll<HTMLTrackElement>("track")) {
    if (element.track === track) return element.src || undefined;
  }
  return undefined;
}

function snapshotTrack(media: HTMLMediaElement, track: TextTrack): RuntimeTextTrackSnapshot {
  return {
    trackId: trackIdFor(track),
    mediaId: mediaIdFor(media),
    language: track.language || document.documentElement.lang || "und",
    label: track.label || track.language || track.kind || "Transcript",
    kind: track.kind,
    mode: track.mode,
    ...(sourceForTrack(media, track) ? { sourceUrl: sourceForTrack(media, track) } : {}),
    cues: cuesFor(track),
  };
}

function playbackState(media: HTMLMediaElement): MediaPlaybackState {
  const duration = Number.isFinite(media.duration) ? media.duration : null;
  return {
    mediaId: mediaIdFor(media),
    pageUrl: location.href,
    title: document.title || location.hostname,
    currentTime: Number.isFinite(media.currentTime) ? media.currentTime : 0,
    duration,
    paused: media.paused,
    ended: media.ended,
    muted: media.muted,
    volume: media.volume,
    readyState: media.readyState,
  };
}

function enableTrackLoading(track: TextTrack): void {
  if (
    track.mode === "disabled"
    && ["subtitles", "captions", "descriptions"].includes(track.kind)
  ) {
    track.mode = "hidden";
  }
}

function observeTrack(track: TextTrack): void {
  enableTrackLoading(track);
  if (observedTracks.has(track)) return;
  observedTracks.add(track);
  track.addEventListener("cuechange", scheduleScan);
}

function observeMediaElement(media: HTMLMediaElement): void {
  if (observedMedia.has(media)) return;
  observedMedia.add(media);
  for (const eventName of [
    "loadedmetadata",
    "durationchange",
    "play",
    "playing",
    "pause",
    "ended",
    "timeupdate",
    "volumechange",
  ]) {
    media.addEventListener(eventName, () => {
      safeSend({ type: "media-playback-state", state: playbackState(media) });
      scheduleScan();
    });
  }
  media.textTracks.addEventListener("addtrack", scheduleScan);
  media.textTracks.addEventListener("change", scheduleScan);
}

function isMediaFrame(frame: HTMLIFrameElement): boolean {
  const features = frame.allow.toLowerCase();
  const identity = [
    frame.src,
    frame.title,
    frame.name,
    frame.id,
    frame.className,
  ].join(" ").toLowerCase();
  return /autoplay|encrypted-media|picture-in-picture|fullscreen/.test(features)
    || /(?:^|[^a-z])(video|player|media|stream|watch|embed)(?:[^a-z]|$)/.test(identity);
}

function requiredOrigins(): string[] {
  const origins = new Set<string>();
  for (const frame of document.querySelectorAll<HTMLIFrameElement>("iframe[src]")) {
    if (!isMediaFrame(frame)) continue;
    try {
      const url = new URL(frame.src, location.href);
      if (url.origin !== location.origin && /^https?:$/.test(url.protocol)) {
        origins.add(url.origin);
      }
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  }
  return [...origins];
}

function collectSnapshot(): PageDiscoverySnapshot {
  const media = [...document.querySelectorAll<HTMLMediaElement>("video, audio")];
  const tracks: RuntimeTextTrackSnapshot[] = [];
  for (const element of media) {
    observeMediaElement(element);
    for (let index = 0; index < element.textTracks.length; index++) {
      const track = element.textTracks[index];
      if (!track) continue;
      observeTrack(track);
      tracks.push(snapshotTrack(element, track));
    }
  }
  return {
    pageUrl: location.href,
    frameUrl: location.href,
    title: document.title || location.hostname,
    documentLanguage: document.documentElement.lang || navigator.language || "und",
    media: media.map(playbackState),
    tracks,
    requiredOrigins: requiredOrigins(),
  };
}

function scan(): void {
  scanTimer = null;
  safeSend({ type: "timed-text-page-snapshot", snapshot: collectSnapshot() });
}

function scheduleScan(): void {
  if (scanTimer !== null) clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, 100);
}

function seek(time: number): void {
  const media = [...document.querySelectorAll<HTMLMediaElement>("video, audio")]
    .sort((left, right) => Number(left.paused) - Number(right.paused))[0];
  if (media) media.currentTime = time;
}

function install(): void {
  if (globalState.__videoTranscriptBridgeInstalled) {
    scheduleScan();
    return;
  }
  globalState.__videoTranscriptBridgeInstalled = true;

  document.addEventListener(CAPTURE_EVENT, (event) => {
    const detail = (event as CustomEvent<string>).detail;
    try {
      safeSend({
        type: "timed-text-resource",
        resource: JSON.parse(detail) as TimedTextResource,
      });
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  });

  chrome.runtime.onMessage.addListener((message: {
    type?: string;
    time?: number;
  }) => {
    if (message.type === "scan-timed-text") {
      scheduleScan();
    } else if (message.type === "seek-to" && typeof message.time === "number") {
      seek(message.time);
    }
    return false;
  });

  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "kind", "srclang", "label"],
  });
  scan();
}

install();
