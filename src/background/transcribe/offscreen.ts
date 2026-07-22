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
  }): Promise<LmAvailability>;
  create(options?: {
    expectedInputs?: LmExpectation[];
    expectedOutputs?: LmExpectation[];
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
} = {
  expectedInputs: [{ type: "audio" }, { type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

const UNAVAILABLE_MESSAGE =
  "On-device transcription isn't available on this device. It needs Chrome's " +
  "built-in AI (Gemini Nano) with a supported GPU. Captions still work on " +
  "video pages that provide them.";

const TRANSCRIBE_INSTRUCTION =
  "Transcribe the speech in this audio clip verbatim. Output only the spoken " +
  "words as plain text — no timestamps, no speaker labels, no notes, no quotation " +
  "marks. If there is no intelligible speech, output nothing.";

// ---------- config ----------

const SAMPLE_RATE = 16_000;
// Nano's audio context budget is undocumented and smaller than Whisper's 30 s
// window; keep windows short to stay under the token ceiling and to give finer
// synthesized timestamps (one Segment per window).
const CHUNK_DURATION_S = 12;
const CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_DURATION_S;

let baseSession: LmSession | null = null;
let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let isCapturing = false;
let isFileTranscribing = false;

function emitError(err: unknown): void {
  chrome.runtime
    .sendMessage({
      type: "transcription-error",
      error: err instanceof Error ? err.message : String(err),
    })
    .catch(() => {});
}

// ---------- Nano session + inference ----------

async function ensureAvailable(): Promise<LmStatic> {
  const lm = getLanguageModel();
  if (!lm) throw new Error(UNAVAILABLE_MESSAGE);
  let status: LmAvailability;
  try {
    status = await lm.availability(AUDIO_MODALITY);
  } catch {
    throw new Error(UNAVAILABLE_MESSAGE);
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
    return out.trim();
  } finally {
    session.destroy();
  }
}

// ---------- audio capture (AudioWorklet) ----------

async function setupAudioCapture(streamId: string): Promise<{
  stream: MediaStream;
  ctx: AudioContext;
  pump: () => Promise<Float32Array | null>;
  stop: () => void;
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
  // Offscreen documents carry no user gesture, so Chrome's autoplay policy can
  // leave a real-time AudioContext "suspended" — which would stop the worklet
  // from ever running and silently kill tab-audio capture. The active
  // tab-capture stream usually lets it start, but resume() makes it explicit
  // (and clears the "AudioContext was not allowed to start" warning).
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  await ctx.audioWorklet.addModule(
    chrome.runtime.getURL("offscreen/worklet-processor.js"),
  );

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "audio-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });

  // Re-route audio so the tab keeps playing audibly while we record.
  // The worklet returns silence on its outputs (default behaviour).
  source.connect(node);
  // Don't connect node to destination — we don't need audio output, just samples.

  let buffer = new Float32Array(0);
  let resolveNext: ((value: Float32Array | null) => void) | null = null;

  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const incoming = e.data;
    const merged = new Float32Array(buffer.length + incoming.length);
    merged.set(buffer, 0);
    merged.set(incoming, buffer.length);
    buffer = merged;

    if (buffer.length >= CHUNK_SAMPLES && resolveNext) {
      const chunk = buffer.slice(0, CHUNK_SAMPLES);
      buffer = buffer.slice(CHUNK_SAMPLES);
      const r = resolveNext;
      resolveNext = null;
      r(chunk);
    }
  };

  let stopped = false;

  return {
    stream,
    ctx,
    async pump() {
      // Resolves with the next CHUNK_SAMPLES of audio, or null when capture
      // is stopped (drains any remaining buffered partial chunk first).
      if (stopped) {
        if (buffer.length > SAMPLE_RATE) {
          const tail = buffer;
          buffer = new Float32Array(0);
          return tail;
        }
        return null;
      }
      if (buffer.length >= CHUNK_SAMPLES) {
        const chunk = buffer.slice(0, CHUNK_SAMPLES);
        buffer = buffer.slice(CHUNK_SAMPLES);
        return chunk;
      }
      return new Promise<Float32Array | null>((resolve) => {
        resolveNext = (value) => resolve(value);
      });
    },
    stop() {
      stopped = true;
      const r = resolveNext;
      resolveNext = null;
      if (r) r(buffer.length > SAMPLE_RATE ? buffer : null);
    },
  };
}

// ---------- main capture loop ----------

async function captureAndTranscribe(
  streamId: string,
  videoId: string,
  title: string,
): Promise<void> {
  isCapturing = true;

  // Probe + warm the session up front so an unsupported device fails loud
  // (clear "needs a GPU" error) instead of silently producing nothing.
  try {
    await getBaseSession();
  } catch (err) {
    emitError(err);
    isCapturing = false;
    return;
  }

  const cap = await setupAudioCapture(streamId);
  mediaStream = cap.stream;
  audioContext = cap.ctx;

  const allSegments: Segment[] = [];
  let chunkIndex = 0;
  let timeOffset = 0;

  try {
    while (isCapturing) {
      const chunk = await cap.pump();
      if (!chunk) break;
      chunkIndex++;

      try {
        const text = await transcribeChunk(chunk);
        if (text) {
          allSegments.push({
            start: timeOffset,
            duration: chunk.length / SAMPLE_RATE,
            text,
          });
        }
        timeOffset += chunk.length / SAMPLE_RATE;

        chrome.runtime
          .sendMessage({
            type: "transcription-progress",
            videoId,
            // No reliable total when streaming live capture; emit a soft
            // "frames decoded" pulse so the UI bar advances.
            progress: Math.min(99, chunkIndex * 5),
            segments: [...allSegments],
          })
          .catch(() => {});
      } catch (err) {
        emitError(err);
        break;
      }
    }

    chrome.runtime
      .sendMessage({
        type: "transcription-complete",
        videoId,
        title,
        segments: allSegments,
      })
      .catch(() => {});
  } finally {
    cap.stop();
    stopCapture();
  }
}

function stopCapture(): void {
  isCapturing = false;
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
  isFileTranscribing = true;
  const sendProgress = (progress: number, segments: Segment[]): void => {
    chrome.runtime
      .sendMessage({ type: "transcription-progress", videoId, progress, segments })
      .catch(() => {});
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

    chrome.runtime
      .sendMessage({
        type: "transcription-complete",
        videoId,
        title,
        segments: allSegments,
      })
      .catch(() => {});
  } catch (err) {
    emitError(err);
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
        stopCapture();
        isFileTranscribing = false;
        break;

      case "offscreen-transcribe-file":
        void transcribeFile(
          message["blobUrl"] as string,
          message["videoId"] as string,
          message["title"] as string,
        );
        break;
    }
  },
);
