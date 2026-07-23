import {
  classifyTimedTextCandidate,
} from "../../lib/timed-text/detect";
import {
  inspectManifest,
  type ManifestInspection,
} from "../../lib/timed-text/manifest";
import { parseTimedText } from "../../lib/timed-text/parse";
import { fetchTimedTextResource } from "./fetch-resource";
import type {
  DiscoveryDiagnostics,
  DiscoveryResponse,
  DiscoveryTarget,
  MediaPlaybackState,
  PageDiscoverySnapshot,
  TimedTextResource,
} from "../../types/discovery";
import type { TranscriptResponse } from "../../types/transcript";
import { recordBroadcast } from "../../lib/intercept/correlator";

const PENDING_PREFIX = "pending-page-discovery:";
const SESSION_PREFIX = "page-discovery-session:";
const VIDEO_INDEX_PREFIX = "page-discovery-video:";
const ACTION_TITLE = "Video Transcript";
const EMPTY_DELAY_MS = 2_500;

interface DiscoveredTrack {
  id: string;
  language: string;
  label: string;
  kind: string;
  format: string;
  source: "page-track" | "network-resource";
  segments: TranscriptResponse["segments"];
}

interface DiscoverySession {
  target: DiscoveryTarget;
  documentLanguage: string;
  media: MediaPlaybackState[];
  tracks: Map<string, DiscoveredTrack>;
  formats: Set<TimedTextResource["format"]>;
  resourceKeys: Set<string>;
  requestedUrls: Set<string>;
  backgroundFetchKeys: Set<string>;
  requiredOrigins: Set<string>;
  candidateCount: number;
  hasInBandCaptions: boolean;
  hasUnsupportedTimedText: boolean;
  selectedTrackId: string | null;
  lastFingerprint: string;
  emptyTimer: ReturnType<typeof setTimeout> | null;
  emptyPublished: boolean;
  adapterAttempted: boolean;
  adapterTranscript: TranscriptResponse | null;
}

interface StoredDiscoverySession {
  target: DiscoveryTarget;
  documentLanguage: string;
  media: MediaPlaybackState[];
  tracks: DiscoveredTrack[];
  formats: TimedTextResource["format"][];
  requiredOrigins: string[];
  candidateCount: number;
  hasInBandCaptions: boolean;
  hasUnsupportedTimedText: boolean;
  selectedTrackId: string | null;
  lastFingerprint: string;
  emptyPublished: boolean;
  adapterAttempted: boolean;
  adapterTranscript: TranscriptResponse | null;
  videoId: string | null;
}

const sessions = new Map<number, DiscoverySession>();

function pendingKey(tabId: number): string {
  return `${PENDING_PREFIX}${tabId}`;
}

function sessionKey(tabId: number): string {
  return `${SESSION_PREFIX}${tabId}`;
}

function videoIndexKey(videoId: string): string {
  return `${VIDEO_INDEX_PREFIX}${videoId}`;
}

function send(message: object): void {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Open a regular http or https media page.");
  }
  return url.href;
}

function capturableUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function titleForTab(tab: chrome.tabs.Tab, url: string): string {
  return tab.title?.trim() || new URL(url).hostname.replace(/^www\./, "");
}

function targetForTab(tab: chrome.tabs.Tab): DiscoveryTarget {
  if (tab.id === undefined || !capturableUrl(tab.url)) {
    throw new Error("Open a regular media page in the active tab.");
  }
  return {
    tabId: tab.id,
    url: tab.url,
    title: titleForTab(tab, tab.url),
  };
}

function diagnostics(session: DiscoverySession): DiscoveryDiagnostics {
  return {
    candidateCount: session.candidateCount,
    detectedFormats: [...session.formats].sort(),
    hasInBandCaptions: session.hasInBandCaptions,
    hasUnsupportedTimedText: session.hasUnsupportedTimedText,
    requiredOrigins: [...session.requiredOrigins].sort(),
  };
}

function newSession(target: DiscoveryTarget): DiscoverySession {
  return {
    target,
    documentLanguage: "und",
    media: [],
    tracks: new Map(),
    formats: new Set(),
    resourceKeys: new Set(),
    requestedUrls: new Set(),
    backgroundFetchKeys: new Set(),
    requiredOrigins: new Set(),
    candidateCount: 0,
    hasInBandCaptions: false,
    hasUnsupportedTimedText: false,
    selectedTrackId: null,
    lastFingerprint: "",
    emptyTimer: null,
    emptyPublished: false,
    adapterAttempted: false,
    adapterTranscript: null,
  };
}

function storedSession(session: DiscoverySession): StoredDiscoverySession {
  const transcript = transcriptFor(session, session.selectedTrackId ?? undefined);
  return {
    target: session.target,
    documentLanguage: session.documentLanguage,
    media: session.media,
    tracks: [...session.tracks.values()],
    formats: [...session.formats],
    requiredOrigins: [...session.requiredOrigins],
    candidateCount: session.candidateCount,
    hasInBandCaptions: session.hasInBandCaptions,
    hasUnsupportedTimedText: session.hasUnsupportedTimedText,
    selectedTrackId: session.selectedTrackId,
    lastFingerprint: session.lastFingerprint,
    emptyPublished: session.emptyPublished,
    adapterAttempted: session.adapterAttempted,
    adapterTranscript: session.adapterTranscript,
    videoId: transcript?.videoId ?? null,
  };
}

function persistSession(session: DiscoverySession): void {
  const stored = storedSession(session);
  const values: Record<string, unknown> = {
    [sessionKey(session.target.tabId)]: stored,
  };
  if (stored.videoId) values[videoIndexKey(stored.videoId)] = session.target.tabId;
  chrome.storage.session.set(values, () => {
    void chrome.runtime.lastError;
  });
}

async function restoreSession(tabId: number): Promise<DiscoverySession | null> {
  const key = sessionKey(tabId);
  const stored = (await chrome.storage.session.get(key))[key] as
    | StoredDiscoverySession
    | undefined;
  if (!stored) return null;

  const session = newSession(stored.target);
  session.documentLanguage = stored.documentLanguage;
  session.media = stored.media;
  session.tracks = new Map(stored.tracks.map((track) => [track.id, track]));
  session.formats = new Set(stored.formats);
  session.requiredOrigins = new Set(stored.requiredOrigins);
  session.candidateCount = stored.candidateCount;
  session.hasInBandCaptions = stored.hasInBandCaptions;
  session.hasUnsupportedTimedText = stored.hasUnsupportedTimedText;
  session.selectedTrackId = stored.selectedTrackId;
  session.lastFingerprint = stored.lastFingerprint;
  session.emptyPublished = stored.emptyPublished;
  session.adapterAttempted = stored.adapterAttempted;
  session.adapterTranscript = stored.adapterTranscript;
  sessions.set(tabId, session);
  return session;
}

function hashUrl(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function optionalOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

function warrantsOriginPermission(resource: TimedTextResource): boolean {
  const classification = classifyTimedTextCandidate(resource.url, resource.mimeType);
  if (!classification.inspectBody) return false;
  if (resource.format !== "json" && resource.format !== "unknown") return true;
  return /timedtext|texttrack|text-track|subtitle|caption|closedcaption|closed-caption|transcript/i
    .test(resource.url);
}

function mergeSegments(
  current: TranscriptResponse["segments"],
  incoming: TranscriptResponse["segments"],
): TranscriptResponse["segments"] {
  const keyed = new Map<string, TranscriptResponse["segments"][number]>();
  for (const segment of [...current, ...incoming]) {
    keyed.set(`${segment.start.toFixed(3)}\u0000${segment.text}`, segment);
  }
  return [...keyed.values()].sort((left, right) => left.start - right.start);
}

function rankTrack(track: DiscoveredTrack): number {
  const role = /^(?:subtitles|captions)$/i.test(track.kind) ? 1_000_000 : 0;
  const runtime = track.source === "page-track" ? 100_000 : 0;
  return role + runtime + track.segments.length;
}

function semanticTrackKey(track: DiscoveredTrack): string {
  return `${track.language}\u0000${track.label}\u0000${track.kind}`;
}

function selectionId(track: DiscoveredTrack): string {
  return `track-${hashUrl(semanticTrackKey(track))}`;
}

function transcriptFor(
  session: DiscoverySession,
  selectedTrackId?: string,
): TranscriptResponse | null {
  if (session.adapterTranscript) return session.adapterTranscript;
  const uniqueTracks = new Map<string, DiscoveredTrack>();
  for (const track of session.tracks.values()) {
    if (track.segments.length === 0) continue;
    const key = semanticTrackKey(track);
    const existing = uniqueTracks.get(key);
    if (
      !existing
      || track.segments.length > existing.segments.length
      || (
        track.segments.length === existing.segments.length
        && track.source === "page-track"
        && existing.source !== "page-track"
      )
    ) {
      uniqueTracks.set(key, track);
    }
  }
  const tracks = [...uniqueTracks.values()]
    .sort((left, right) => rankTrack(right) - rankTrack(left));
  const selected = tracks.find((track) => selectionId(track) === selectedTrackId) ?? tracks[0];
  if (!selected) return null;
  return {
    videoId: `page-${hashUrl(session.target.url)}`,
    title: session.target.title,
    language: selected.language,
    isAutoGenerated: selected.kind === "asr",
    tracks: tracks.map((track) => ({
      id: selectionId(track),
      languageCode: track.language,
      name: track.label,
      kind: track.kind,
      format: track.format,
      source: track.source,
    })),
    segments: selected.segments,
    pageUrl: session.target.url,
    source: selected.source,
  };
}

function bestMedia(session: DiscoverySession): MediaPlaybackState | null {
  return [...session.media].sort((left, right) => {
    if (left.ended !== right.ended) return Number(left.ended) - Number(right.ended);
    if (left.paused !== right.paused) return Number(left.paused) - Number(right.paused);
    if (left.muted !== right.muted) return Number(left.muted) - Number(right.muted);
    if ((left.volume === 0) !== (right.volume === 0)) {
      return Number(left.volume === 0) - Number(right.volume === 0);
    }
    if (left.readyState !== right.readyState) return right.readyState - left.readyState;
    return (right.duration ?? 0) - (left.duration ?? 0);
  })[0] ?? null;
}

function scheduleEmpty(session: DiscoverySession): void {
  if (session.emptyTimer !== null) clearTimeout(session.emptyTimer);
  session.emptyTimer = setTimeout(() => {
    session.emptyTimer = null;
    if (transcriptFor(session)) return;
    if (!session.adapterAttempted && supportsOptionalPageAdapter(session.target.url)) {
      session.adapterAttempted = true;
      void chrome.scripting.executeScript({
        target: { tabId: session.target.tabId },
        files: ["content/adapters/youtube.js"],
        world: "ISOLATED",
        injectImmediately: true,
      }).then(() => {
        scheduleEmpty(session);
      }).catch(() => {
        session.hasUnsupportedTimedText = true;
        scheduleEmpty(session);
      });
      return;
    }
    session.emptyPublished = true;
    persistSession(session);
    send({
      type: "discovery-empty",
      target: session.target,
      diagnostics: diagnostics(session),
      media: bestMedia(session),
    });
  }, EMPTY_DELAY_MS);
}

function supportsOptionalPageAdapter(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "youtube.com" || hostname.endsWith(".youtube.com");
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function publish(session: DiscoverySession, selectedTrackId?: string): TranscriptResponse | null {
  if (selectedTrackId) session.selectedTrackId = selectedTrackId;
  const transcript = transcriptFor(session, session.selectedTrackId ?? undefined);
  if (!transcript) {
    scheduleEmpty(session);
    return null;
  }
  if (session.emptyTimer !== null) {
    clearTimeout(session.emptyTimer);
    session.emptyTimer = null;
  }
  session.emptyPublished = false;
  const fingerprint = `${session.selectedTrackId ?? ""}:${transcript.tracks.length}:${
    transcript.language
  }:${transcript.segments.length}:${
    transcript.segments.at(-1)?.text ?? ""
  }`;
  if (fingerprint === session.lastFingerprint) return transcript;
  session.lastFingerprint = fingerprint;
  persistSession(session);
  recordBroadcast(session.target.tabId);
  send({
    type: "discovery-result",
    target: session.target,
    data: transcript,
    diagnostics: diagnostics(session),
  });
  return transcript;
}

async function setPendingBadge(tabId: number): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: "SCAN" }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" }),
    chrome.action.setTitle({ tabId, title: "Click to find this page's transcript" }),
  ]);
}

async function clearBadge(tabId: number): Promise<void> {
  await Promise.allSettled([
    chrome.action.setBadgeText({ tabId, text: "" }),
    chrome.action.setTitle({ tabId, title: ACTION_TITLE }),
  ]);
}

async function pendingTarget(tabId: number): Promise<DiscoveryTarget | undefined> {
  const key = pendingKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key] as DiscoveryTarget | undefined;
}

async function arm(target: DiscoveryTarget): Promise<DiscoveryResponse> {
  await chrome.storage.session.set({ [pendingKey(target.tabId)]: target });
  await setPendingBadge(target.tabId);
  send({ type: "discovery-awaiting-action", ...target });
  return { status: "awaiting-action", ...target };
}

function permissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /activeTab|permission|cannot access|cannot be scripted|not allowed|extensions gallery/i.test(message);
}

async function injectDiscovery(target: DiscoveryTarget): Promise<DiscoveryResponse> {
  await clearDiscoveryTab(target.tabId);
  const session = newSession(target);
  sessions.set(target.tabId, session);
  send({ type: "discovery-started", ...target });

  await chrome.scripting.executeScript({
    target: { tabId: target.tabId, allFrames: true },
    files: ["content/timed-text-bridge.js"],
    world: "ISOLATED",
    injectImmediately: true,
  });
  await chrome.scripting.executeScript({
    target: { tabId: target.tabId, allFrames: true },
    files: ["content/timed-text-main.js"],
    world: "MAIN",
    injectImmediately: true,
  });
  chrome.tabs.sendMessage(target.tabId, { type: "scan-timed-text" }, () => {
    void chrome.runtime.lastError;
  });
  await chrome.storage.session.remove(pendingKey(target.tabId));
  await clearBadge(target.tabId);
  scheduleEmpty(session);
  return { status: "discovering", ...target };
}

async function injectOrArm(target: DiscoveryTarget): Promise<DiscoveryResponse> {
  try {
    return await injectDiscovery(target);
  } catch (error) {
    sessions.delete(target.tabId);
    if (permissionError(error)) return arm(target);
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Could not inspect this media page.",
    };
  }
}

export async function discoverCurrentTab(): Promise<DiscoveryResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { status: "error", error: "Open a media page, then try again." };
  try {
    return await injectOrArm(targetForTab(tab));
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Could not inspect the active tab.",
    };
  }
}

export async function rediscoverTab(tabId: number): Promise<DiscoveryResponse> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return injectOrArm(targetForTab(tab));
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Could not inspect the media tab.",
    };
  }
}

export async function prepareUrlDiscovery(value: string): Promise<DiscoveryResponse> {
  let url: string;
  try {
    url = normalizeUrl(value);
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Enter a valid media URL.",
    };
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url === url) return injectOrArm(targetForTab(active));
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    if (tab.id === undefined) {
      return { status: "error", error: "Chrome did not provide the opened tab." };
    }
    return arm({
      tabId: tab.id,
      url,
      title: tab.title?.trim() || new URL(url).hostname.replace(/^www\./, ""),
    });
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Could not open this media page.",
    };
  }
}

export async function getDiscoveryState(): Promise<DiscoveryResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { status: "idle" };
  const pending = await pendingTarget(tab.id);
  if (pending) return { status: "awaiting-action", ...pending };
  const session = sessions.get(tab.id) ?? await restoreSession(tab.id);
  if (!session) return { status: "idle" };
  const data = transcriptFor(session, session.selectedTrackId ?? undefined);
  if (data) {
    return {
      status: "found",
      target: session.target,
      data,
      diagnostics: diagnostics(session),
    };
  }
  if (session.emptyPublished) {
    return {
      status: "empty",
      target: session.target,
      diagnostics: diagnostics(session),
      media: bestMedia(session),
    };
  }
  return { status: "discovering", ...session.target };
}

export async function cancelPendingDiscovery(tabId: number): Promise<void> {
  await chrome.storage.session.remove(pendingKey(tabId));
  await clearBadge(tabId);
}

export async function handleDiscoveryAction(tab: chrome.tabs.Tab): Promise<boolean> {
  if (tab.id === undefined || !capturableUrl(tab.url)) return false;
  const pending = await pendingTarget(tab.id);
  const target = pending ?? targetForTab(tab);
  const response = await injectDiscovery(target).catch((error: unknown) => ({
    status: "error" as const,
    error: error instanceof Error ? error.message : "Could not inspect this media page.",
  }));
  if (response.status === "error") {
    send({ type: "discovery-error", error: response.error, target });
  }
  return true;
}

export function recordPageSnapshot(
  tabId: number,
  frameId: number,
  snapshot: PageDiscoverySnapshot,
): void {
  let session = sessions.get(tabId);
  if (!session) return;
  if (frameId === 0) {
    if (session.target.url !== snapshot.pageUrl) {
      if (session.emptyTimer !== null) clearTimeout(session.emptyTimer);
      const previousVideoId = `page-${hashUrl(session.target.url)}`;
      const next = newSession({
        tabId,
        url: snapshot.pageUrl,
        title: snapshot.title || session.target.title,
      });
      sessions.set(tabId, next);
      session = next;
      chrome.storage.session.remove(videoIndexKey(previousVideoId), () => {
        void chrome.runtime.lastError;
      });
      persistSession(session);
    }
    session.target.url = snapshot.pageUrl;
    session.target.title = snapshot.title || session.target.title;
    session.documentLanguage = snapshot.documentLanguage || "und";
  }
  const frameMedia = snapshot.media.map((state) => ({
    ...state,
    mediaId: `${frameId}:${state.mediaId}`,
  }));
  session.media = [
    ...session.media.filter((state) => !state.mediaId.startsWith(`${frameId}:`)),
    ...frameMedia,
  ];
  const activeMedia = bestMedia(session);
  if (activeMedia) send({ type: "media-playback-state", state: activeMedia });
  for (const origin of snapshot.requiredOrigins) {
    session.requiredOrigins.add(origin);
  }
  const runtimePrefix = `${frameId}:runtime:`;
  for (const trackId of session.tracks.keys()) {
    if (trackId.startsWith(runtimePrefix)) session.tracks.delete(trackId);
  }
  for (const track of snapshot.tracks) {
    if (track.cues.length === 0) continue;
    const id = `${frameId}:runtime:${track.trackId}`;
    session.tracks.set(id, {
      id,
      language: track.language || session.documentLanguage,
      label: track.label || track.language || "Transcript",
      kind: track.kind,
      format: track.sourceUrl?.toLowerCase().includes(".vtt") ? "webvtt" : "runtime",
      source: "page-track",
      segments: track.cues,
    });
  }
  publish(session);
}

function applyManifestInspection(
  session: DiscoverySession,
  frameId: number,
  parent: TimedTextResource,
  inspection: ManifestInspection,
): void {
  session.hasInBandCaptions ||= inspection.hasInBandCaptions;
  session.hasUnsupportedTimedText ||= inspection.hasUnsupportedSegments;
  for (const resource of inspection.resources) {
    const key = `${frameId}:${resource.url}`;
    if (session.requestedUrls.has(key)) continue;
    session.requestedUrls.add(key);
    void recordTimedTextResource(
      session.target.tabId,
      frameId,
      {
        url: resource.url,
        mimeType: "",
        format: resource.format,
        source: "manifest",
        language: resource.language ?? parent.language,
        label: resource.label ?? parent.label,
        kind: parent.kind,
        trackId: parent.trackId ?? `manifest:${parent.url}`,
      },
    );
  }
}

export async function recordTimedTextResource(
  tabId: number,
  frameId: number,
  resource: TimedTextResource,
): Promise<void> {
  const session = sessions.get(tabId);
  if (!session) return;
  const resourceKey = `${frameId}:${resource.url}:${resource.source}`;
  if (!session.resourceKeys.has(resourceKey)) {
    session.resourceKeys.add(resourceKey);
    session.candidateCount++;
  }
  session.formats.add(resource.format);
  if (resource.format === "mp4" || resource.format === "bitmap") {
    session.hasUnsupportedTimedText = true;
  }
  if (!resource.bodyText) {
    const origin = optionalOrigin(resource.url);
    if (!resource.error && origin && warrantsOriginPermission(resource)) {
      const originPattern = `${origin}/*`;
      const permitted = await chrome.permissions.contains({ origins: [originPattern] });
      if (sessions.get(tabId) !== session) return;
      if (permitted) {
        session.requiredOrigins.delete(origin);
        const fetchKey = `${frameId}:${resource.url}`;
        if (!session.backgroundFetchKeys.has(fetchKey)) {
          session.backgroundFetchKeys.add(fetchKey);
          const fetched = await fetchTimedTextResource(resource);
          if (sessions.get(tabId) !== session) return;
          await recordTimedTextResource(tabId, frameId, fetched);
          return;
        }
      } else {
        session.requiredOrigins.add(origin);
      }
    }
    scheduleEmpty(session);
    return;
  }

  if (resource.format === "hls" || resource.format === "dash") {
    const inspection = inspectManifest(
      resource.bodyText,
      resource.url,
      resource.format,
      Boolean(resource.trackId || resource.language || resource.label),
    );
    applyManifestInspection(session, frameId, resource, inspection);
    scheduleEmpty(session);
    return;
  }

  const parsed = parseTimedText(resource.bodyText, {
    format: resource.format,
    mimeType: resource.mimeType,
    url: resource.url,
  });
  session.formats.add(parsed.format);
  if (parsed.segments.length === 0) {
    scheduleEmpty(session);
    return;
  }
  const id = `${frameId}:resource:${resource.trackId ?? resource.url}`;
  const previous = session.tracks.get(id);
  session.tracks.set(id, {
    id,
    language: resource.language || previous?.language || session.documentLanguage,
    label: resource.label || previous?.label || resource.language || "Transcript",
    kind: resource.kind || previous?.kind || "subtitles",
    format: parsed.format,
    source: "network-resource",
    segments: mergeSegments(previous?.segments ?? [], parsed.segments),
  });
  publish(session);
}

export function recordMediaState(
  tabId: number,
  frameId: number,
  state: MediaPlaybackState,
): void {
  const session = sessions.get(tabId);
  if (!session) return;
  const framedState = {
    ...state,
    mediaId: `${frameId}:${state.mediaId}`,
  };
  session.media = [
    ...session.media.filter((item) => item.mediaId !== framedState.mediaId),
    framedState,
  ];
  const activeMedia = bestMedia(session);
  if (activeMedia) send({ type: "media-playback-state", state: activeMedia });
}

export function currentMediaState(tabId: number): MediaPlaybackState | null {
  const session = sessions.get(tabId);
  return session ? bestMedia(session) : null;
}

export function recordAdapterTranscript(
  tabId: number,
  transcript: TranscriptResponse,
): void {
  const session = sessions.get(tabId);
  if (!session) return;
  session.adapterTranscript = {
    ...transcript,
    pageUrl: session.target.url,
    source: "platform-adapter",
  };
  session.emptyPublished = false;
  if (session.emptyTimer !== null) {
    clearTimeout(session.emptyTimer);
    session.emptyTimer = null;
  }
  persistSession(session);
}

export async function selectDiscoveredTrack(
  videoId: string,
  trackId: string,
): Promise<TranscriptResponse | null> {
  for (const session of sessions.values()) {
    const transcript = transcriptFor(session, trackId);
    if (transcript?.videoId !== videoId) continue;
    publish(session, trackId);
    return transcript;
  }

  const indexKey = videoIndexKey(videoId);
  const tabId = (await chrome.storage.session.get(indexKey))[indexKey];
  if (typeof tabId !== "number") return null;
  const restored = await restoreSession(tabId);
  const transcript = restored ? transcriptFor(restored, trackId) : null;
  if (!restored || transcript?.videoId !== videoId) return null;
  publish(restored, trackId);
  return transcript;
}

export async function clearDiscoveryTab(tabId: number): Promise<void> {
  const session = sessions.get(tabId);
  if (session && session.emptyTimer !== null) clearTimeout(session.emptyTimer);
  sessions.delete(tabId);

  const key = sessionKey(tabId);
  const stored = (await chrome.storage.session.get(key))[key] as
    | StoredDiscoverySession
    | undefined;
  const videoId = stored?.videoId
    ?? (session ? transcriptFor(session, session.selectedTrackId ?? undefined)?.videoId : null);
  await chrome.storage.session.remove([
    key,
    ...(videoId ? [videoIndexKey(videoId)] : []),
  ]);
}
