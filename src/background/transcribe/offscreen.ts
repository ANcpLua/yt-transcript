// Offscreen document — captures tab audio (or decodes a dropped file) and
// transcribes it on-device with Chrome's built-in AI (Gemini Nano) via the
// Prompt API's audio input. No model download and no bundled ML runtime:
// Chrome manages the model. Audio input requires a GPU; when it isn't
// available we surface a clear error and the panel stays on captions-only.
//
// The Prompt API only runs in a document context (not the MV3 service
// worker), which is why transcription lives here. Talks to the service
// worker via chrome.runtime.sendMessage — no other surface.
//
// NOTE: the Gemini Nano audio path needs verification in real Chrome
// (desktop, supported GPU, recent build); it cannot run in CI/headless.

export {};

import type { Segment } from "@/types/transcript";
import {
  isSilentPcm,
  sanitizeTranscription,
} from "@/lib/transcription/audio";

// ---------- Chrome Prompt API (audio input) typings ----------
// Text-only LanguageModel types live in lib/ai/chrome-ai.ts; the multimodal
// (audio) surface is declared locally and reached via globalThis so there is
// no clash with the text path's declaration.

type AudioValue = AudioBuffer | Blob | ArrayBuffer | ArrayBufferView;

interface LmPart {
  type: "text" | "audio";
  value: string | AudioValue;
}

interface LmMessage {
  role: "system" | "user" | "assistant";
  content: LmPart[];
}

interface LmExpectation {
  type: "text" | "audio";
  languages?: string[];
}

interface LmSession {
  prompt(input: LmMessage[], options?: { signal?: AbortSignal }): Promise<string>;
  clone(options?: { signal?: AbortSignal }): Promise<LmSession>;
  destroy(): void;
}

interface LmDownloadMonitor {
  addEventListener(
    type: "downloadprogress",
    listener: (event: { loaded: number }) => void,
  ): void;
}

type LmAvailability = "unavailable" | "downloadable" | "downloading" | "available";

interface LmStatic {
  availability(options?: {
    expectedInputs?: LmExpectation[];
    expectedOutputs?: LmExpectation[];
    outputLanguage?: string;
  }): Promise<LmAvailability>;
  create(options?: {
    expectedInputs?: LmExpectation[];
    expectedOutputs?: LmExpectation[];
    outputLanguage?: string;
    initialPrompts?: LmMessage[];
    monitor?: (monitor: LmDownloadMonitor) => void;
    signal?: AbortSignal;
  }): Promise<LmSession>;
}

function getLanguageModel(): LmStatic | undefined {
  return (globalThis as { LanguageModel?: LmStatic }).LanguageModel;
}

const AUDIO_MODALITY: {
  expectedInputs: LmExpectation[];
  expectedOutputs: LmExpectation[];
  outputLanguage: string;
} = {
  expectedInputs: [
    { type: "audio", languages: ["en"] },
    { type: "text", languages: ["en"] },
  ],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
  outputLanguage: "en",
};

const UNAVAILABLE_MESSAGE =
  "On-device transcription isn't available on this device. It needs Chrome's " +
  "built-in AI (Gemini Nano) with a supported GPU. Captions still work on " +
  "video pages that provide them.";

const TRANSCRIBE_INSTRUCTION =
  "Transcribe the speech in this audio clip verbatim. Output only the spoken " +
  "words as plain text — no timestamps, no speaker labels, no notes, no quotation " +
  "marks. If there is no intelligible speech, output nothing.";
const TRANSCRIBE_SYSTEM =
  "You are a speech-to-text engine. Return only words actually spoken in the " +
  "audio. Never explain limitations, answer the speaker, or offer help.";

// ---------- config ----------

const SAMPLE_RATE = 16_000;
// Nano's audio context budget is undocumented; keep windows short to stay
// under the token ceiling and to give finer
// synthesized timestamps (one Segment per window).
const CHUNK_DURATION_S = 8;
const CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_DURATION_S;
const SILENCE_RMS = 0.002;

let baseSession: LmSession | null = null;
let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let isCapturing = false;
let isFileTranscribing = false;
let finalizeCapture = false;
let stopActiveAudioPump: (() => void) | null = null;
let suspendActiveAudioPump: ((suspended: boolean) => void) | null = null;
let playbackPosition: number | null = null;
let playbackSuspended = false;

function sendPanelMessage(message: object): void {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}

function emitError(err: unknown, videoId?: string): void {
  sendPanelMessage({
    type: "transcription-error",
    ...(videoId ? { videoId } : {}),
    error: err instanceof Error ? err.message : String(err),
  });
}

// ---------- Nano session + inference ----------

async function ensureAvailable(): Promise<LmStatic> {
  const lm = getLanguageModel();
  if (!lm) throw new Error(UNAVAILABLE_MESSAGE);
  let status: LmAvailability;
  try {
    status = await lm.availability(AUDIO_MODALITY);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${UNAVAILABLE_MESSAGE} Chrome reported: ${detail}`);
  }
  if (status === "unavailable") throw new Error(UNAVAILABLE_MESSAGE);
  return lm;
}

async function getBaseSession(
  onDownload?: (percent: number) => void,
): Promise<LmSession> {
  if (baseSession) return baseSession;
  const lm = await ensureAvailable();
  baseSession = await lm.create({
    ...AUDIO_MODALITY,
    initialPrompts: [{
      role: "system",
      content: [{ type: "text", value: TRANSCRIBE_SYSTEM }],
    }],
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        onDownload?.(Math.max(1, Math.min(99, Math.round((event.loaded ?? 0) * 100))));
      });
    },
  });
  return baseSession;
}

function pcmToAudioBuffer(pcm: Float32Array): AudioBuffer {
  const buffer = new AudioBuffer({
    length: pcm.length,
    numberOfChannels: 1,
    sampleRate: SAMPLE_RATE,
  });
  // Copy into a fresh ArrayBuffer-backed view — copyToChannel's typing
  // rejects a possibly-SharedArrayBuffer-backed Float32Array.
  buffer.copyToChannel(new Float32Array(pcm), 0);
  return buffer;
}

// Transcribe one PCM window to text. Each window is prompted on an isolated
// (cloned) context so a prior chunk's audio never bleeds into the model's view.
async function transcribeChunk(pcm: Float32Array): Promise<string> {
  if (isSilentPcm(pcm, SILENCE_RMS)) return "";
  const base = await getBaseSession();
  const session = await base.clone();
  try {
    const out = await session.prompt([
      {
        role: "user",
        content: [
          { type: "text", value: TRANSCRIBE_INSTRUCTION },
          { type: "audio", value: pcmToAudioBuffer(pcm) },
        ],
      },
    ]);
    return sanitizeTranscription(out);
  } finally {
    session.destroy();
  }
}

// ---------- audio capture (AudioWorklet) ----------

async function setupAudioCapture(streamId: string): Promise<{
  stream: MediaStream;
  ctx: AudioContext;
  startPump: () => Promise<() => Promise<Float32Array | null>>;
  stopPump: () => void;
  setSuspended: (suspended: boolean) => void;
}> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    } as MediaTrackConstraints,
  });

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  if (ctx.state === "suspended") await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  source.connect(ctx.destination);

  const frames: Float32Array[] = [];
  let firstFrameIndex = 0;
  let firstFrameOffset = 0;
  let bufferedSamples = 0;
  let resolveNext: ((value: Float32Array | null) => void) | null = null;
  let stopped = false;
  let suspended = false;

  const clearFrames = (): void => {
    frames.length = 0;
    firstFrameIndex = 0;
    firstFrameOffset = 0;
    bufferedSamples = 0;
  };

  const takeSamples = (count: number): Float32Array => {
    const output = new Float32Array(count);
    let written = 0;
    while (written < count) {
      const frame = frames[firstFrameIndex];
      if (!frame) break;
      const available = frame.length - firstFrameOffset;
      const copyCount = Math.min(available, count - written);
      output.set(frame.subarray(firstFrameOffset, firstFrameOffset + copyCount), written);
      written += copyCount;
      firstFrameOffset += copyCount;
      bufferedSamples -= copyCount;
      if (firstFrameOffset === frame.length) {
        firstFrameIndex++;
        firstFrameOffset = 0;
      }
    }
    if (firstFrameIndex > 0) {
      frames.splice(0, firstFrameIndex);
      firstFrameIndex = 0;
    }
    return output;
  };

  const takeTail = (): Float32Array | null => {
    if (bufferedSamples < SAMPLE_RATE) return null;
    return takeSamples(bufferedSamples);
  };

  const stopPump = (): void => {
    if (stopped) return;
    stopped = true;
    const resolve = resolveNext;
    resolveNext = null;
    if (resolve) resolve(takeTail());
  };

  for (const track of stream.getTracks()) {
    track.addEventListener("ended", () => {
      finalizeCapture = true;
      isCapturing = false;
      stopPump();
    }, { once: true });
  }

  return {
    stream,
    ctx,
    async startPump() {
      await ctx.audioWorklet.addModule(
        chrome.runtime.getURL("offscreen/worklet-processor.js"),
      );
      if (stopped) return async () => null;

      const node = new AudioWorkletNode(ctx, "audio-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const silentSink = ctx.createGain();
      silentSink.gain.value = 0;
      source.connect(node);
      node.connect(silentSink);
      silentSink.connect(ctx.destination);

      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (suspended) return;
        const incoming = event.data;
        frames.push(incoming);
        bufferedSamples += incoming.length;
        if (bufferedSamples >= CHUNK_SAMPLES && resolveNext) {
          const resolve = resolveNext;
          resolveNext = null;
          resolve(takeSamples(CHUNK_SAMPLES));
        }
      };

      return async () => {
        if (bufferedSamples >= CHUNK_SAMPLES) {
          return takeSamples(CHUNK_SAMPLES);
        }
        if (stopped) return takeTail();
        return new Promise<Float32Array | null>((resolve) => {
          resolveNext = resolve;
        });
      };
    },
    stopPump,
    setSuspended(value) {
      suspended = value;
      if (suspended) clearFrames();
    },
  };
}

// ---------- main capture loop ----------

async function captureAndTranscribe(
  streamId: string,
  videoId: string,
  title: string,
): Promise<void> {
  if (isCapturing || isFileTranscribing) {
    emitError(new Error("Another on-device transcription is already running."), videoId);
    return;
  }
  isCapturing = true;
  finalizeCapture = false;
  playbackSuspended = false;
  const allSegments: Segment[] = [];
  let timeOffset = 0;
  let cap: Awaited<ReturnType<typeof setupAudioCapture>> | null = null;

  const sendProgress = (progress: number): void => {
    sendPanelMessage({
      type: "transcription-progress",
      videoId,
      progress,
      segments: [...allSegments],
    });
  };

  try {
    // Consume the short-lived tabCapture stream ID immediately. The model can
    // then warm up without letting Chrome expire the ID.
    cap = await setupAudioCapture(streamId);
    mediaStream = cap.stream;
    audioContext = cap.ctx;
    stopActiveAudioPump = cap.stopPump;
    suspendActiveAudioPump = cap.setSuspended;
    cap.setSuspended(playbackSuspended);

    // Begin buffering immediately so speech is not lost while Chrome prepares
    // or downloads its managed model.
    const pump = await cap.startPump();
    await getBaseSession((percent) => {
      sendProgress(Math.max(1, Math.round(percent * 0.2)));
    });
    if (!isCapturing && !finalizeCapture) return;

    while (true) {
      const chunk = await pump();
      if (!chunk) break;

      const text = await transcribeChunk(chunk);
      const duration = chunk.length / SAMPLE_RATE;
      const segmentStart = playbackPosition === null
        ? timeOffset
        : Math.max(0, playbackPosition - duration);
      if (text) {
        allSegments.push({
          start: segmentStart,
          duration,
          text,
        });
      }
      timeOffset += duration;
      sendProgress(0);
      if (!isCapturing && !finalizeCapture) break;
    }

    if (!finalizeCapture) return;
    if (allSegments.length === 0) {
      throw new Error("No speech was captured. Start playback, then try again.");
    }

    sendPanelMessage({
      type: "transcription-complete",
      videoId,
      title,
      segments: allSegments,
    });
  } catch (error) {
    emitError(error, videoId);
  } finally {
    cap?.stopPump();
    stopCapture(false);
  }
}

function stopCapture(shouldFinalize: boolean): void {
  finalizeCapture = shouldFinalize;
  isCapturing = false;
  stopActiveAudioPump?.();
  stopActiveAudioPump = null;
  suspendActiveAudioPump = null;
  playbackPosition = null;
  playbackSuspended = false;
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
    mediaStream = null;
  }
  if (audioContext && audioContext.state !== "closed") {
    void audioContext.close();
  }
  audioContext = null;
}

// ---------- file transcription (drag-and-drop / picker) ----------

// decodeAudioData resamples to the context's sample rate and demuxes the
// audio track out of video containers (MP4, WebM, MOV, …) — Chrome routes
// it through the same media stack as <video>. One decode call gives us
// 16 kHz PCM regardless of what the user dropped.
async function decodeToMono16k(blobUrl: string): Promise<Float32Array> {
  const response = await fetch(blobUrl);
  const encoded = await response.arrayBuffer();
  let decoded: AudioBuffer;
  try {
    const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    decoded = await ctx.decodeAudioData(encoded);
  } catch {
    throw new Error(
      "Could not decode audio from this file. Most video/audio formats work (MP4, WebM, MOV, MP3, WAV, OGG, FLAC); DRM-protected media does not.",
    );
  }
  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
  // Mix down to mono — average all channels.
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    channels.push(decoded.getChannelData(ch));
  }
  const out = new Float32Array(decoded.length);
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    out[i] = sum / channels.length;
  }
  return out;
}

async function transcribeFile(
  blobUrl: string,
  videoId: string,
  title: string,
): Promise<void> {
  if (isCapturing || isFileTranscribing) {
    emitError(new Error("Another on-device transcription is already running."), videoId);
    return;
  }
  isFileTranscribing = true;
  const sendProgress = (progress: number, segments: Segment[]): void => {
    sendPanelMessage({ type: "transcription-progress", videoId, progress, segments });
  };
  try {
    // The model may need a first-run (Chrome-managed) download; surface it as
    // the first 20% of the bar. Throws loudly on unsupported hardware.
    await getBaseSession((percent) => sendProgress(Math.max(1, Math.round(percent * 0.2)), []));
    if (!isFileTranscribing) return;

    const pcm = await decodeToMono16k(blobUrl);
    const totalSamples = pcm.length;
    const allSegments: Segment[] = [];
    let offset = 0;

    while (isFileTranscribing && offset < totalSamples) {
      const end = Math.min(offset + CHUNK_SAMPLES, totalSamples);
      const chunk = pcm.subarray(offset, end);
      // A sub-second tail after real content is decoder noise, not speech.
      if (chunk.length < SAMPLE_RATE && allSegments.length > 0) break;
      const timeOffset = offset / SAMPLE_RATE;
      const text = await transcribeChunk(new Float32Array(chunk));
      if (text) {
        allSegments.push({
          start: timeOffset,
          duration: chunk.length / SAMPLE_RATE,
          text,
        });
      }
      offset = end;
      sendProgress(
        Math.min(99, 20 + Math.floor((offset / totalSamples) * 79)),
        [...allSegments],
      );
    }

    // User hit Stop — the panel already reset itself; stay quiet.
    if (!isFileTranscribing) return;

    sendPanelMessage({
      type: "transcription-complete",
      videoId,
      title,
      segments: allSegments,
    });
  } catch (err) {
    emitError(err, videoId);
  } finally {
    isFileTranscribing = false;
  }
}

// ---------- service worker bridge ----------

chrome.runtime.onMessage.addListener(
  (message: { type: string; [key: string]: unknown }) => {
    switch (message.type) {
      case "offscreen-start-capture":
        void captureAndTranscribe(
          message["streamId"] as string,
          message["videoId"] as string,
          message["title"] as string,
        );
        break;

      case "offscreen-stop-capture":
        stopCapture(true);
        isFileTranscribing = false;
        break;

      case "offscreen-transcribe-file":
        void transcribeFile(
          message["blobUrl"] as string,
          message["videoId"] as string,
          message["title"] as string,
        );
        break;

      case "media-playback-state": {
        const state = message["state"];
        if (typeof state !== "object" || state === null) break;
        const playback = state as {
          currentTime?: unknown;
          paused?: unknown;
          ended?: unknown;
          muted?: unknown;
        };
        if (typeof playback.currentTime === "number") {
          playbackPosition = playback.currentTime;
        }
        const suspended = playback.paused === true || playback.muted === true;
        playbackSuspended = suspended;
        suspendActiveAudioPump?.(suspended);
        if (playback.ended === true && isCapturing) stopCapture(true);
        break;
      }
    }
  },
);
