// Offscreen document — captures tab audio, runs Whisper locally.
//
// 2026 stack:
//   - @huggingface/transformers v3 with WebGPU when available, WASM fallback.
//   - AudioWorklet for the capture path (ScriptProcessorNode is deprecated).
//   - Streaming chunk processor with async generator semantics so progress
//     emits as soon as each 30 s window is decoded, not after the whole
//     recording.
//
// Communicates with the service worker via chrome.runtime.sendMessage —
// no other surface.

export {};

import type { Segment } from "@/types/transcript";

interface WhisperPipeline {
  (
    audio: Float32Array,
    options: {
      return_timestamps: boolean;
      chunk_length_s: number;
      stride_length_s: number;
    },
  ): Promise<{
    text: string;
    chunks?: { timestamp: [number, number]; text: string }[];
  }>;
}

// Subset of @huggingface/transformers' ProgressInfo we actually consume.
// Defined locally so we don't pull an internal type path through tsc.
interface PipelineProgressInfo {
  status: "initiate" | "download" | "progress" | "done" | "ready";
  file?: string;
  name?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

const MODEL_MAP = {
  tiny: "onnx-community/whisper-tiny.en",
  base: "onnx-community/whisper-base.en",
} as const;

const SAMPLE_RATE = 16_000;
const CHUNK_DURATION_S = 30;
const CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_DURATION_S;
const STRIDE_S = 5;

// Emit at most one progress update every PROGRESS_THROTTLE_MS so the UI
// gets smooth motion without a per-chunk message flood.
const PROGRESS_THROTTLE_MS = 200;

let pipeline: WhisperPipeline | null = null;
let pipelineModel: "tiny" | "base" | null = null;
let pipelineDevice: "webgpu" | "wasm" | null = null;
let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let isCapturing = false;

function hasWebGpu(): boolean {
  return typeof (navigator as Navigator & { gpu?: unknown }).gpu !== "undefined";
}

async function loadPipeline(
  model: "tiny" | "base",
  onProgress?: (percent: number) => void,
): Promise<WhisperPipeline> {
  // Re-use a cached pipeline only when it matches the requested model —
  // a user who flips Tiny → Base in Settings must trigger a fresh load.
  if (pipeline && pipelineModel === model) return pipeline;
  if (pipeline && pipelineModel !== model) {
    pipeline = null;
    pipelineDevice = null;
    pipelineModel = null;
  }

  const transformers = await import("@huggingface/transformers");

  // Pin the ORT runtime to the bundled vendor copy so MV3's CSP doesn't
  // try to fetch ort-wasm-simd-threaded.jsep.{mjs,wasm} from jsdelivr.
  // numThreads=1 because chrome-extension:// pages can't get the
  // crossOriginIsolated headers the threaded ORT build needs.
  const wasmEnv = transformers.env.backends.onnx.wasm;
  if (wasmEnv) {
    wasmEnv.wasmPaths = chrome.runtime.getURL("vendor/transformers/");
    wasmEnv.numThreads = 1;
  }
  transformers.env.allowLocalModels = false;
  transformers.env.allowRemoteModels = true;

  const { pipeline: createPipeline } = transformers;
  const modelId = MODEL_MAP[model];

  // Aggregate per-file download progress into one 0–99% bar. Transformers.js
  // emits five status types per file (initiate / download / progress / done /
  // ready); we keep the latest 0-100 reading per file and average across all
  // files seen so far, throttled to PROGRESS_THROTTLE_MS so we don't flood
  // chrome.runtime.sendMessage.
  const fileProgress = new Map<string, number>();
  let lastEmit = 0;
  const emit = (force = false): void => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastEmit < PROGRESS_THROTTLE_MS) return;
    lastEmit = now;
    if (fileProgress.size === 0) {
      onProgress(1);
      return;
    }
    let sum = 0;
    for (const v of fileProgress.values()) sum += v;
    const avg = sum / fileProgress.size;
    // Clamp to 1..99 — the caller emits the final 100% once the awaited
    // createPipeline resolves so the UI flips cleanly from progress → ready.
    onProgress(Math.max(1, Math.min(99, Math.floor(avg))));
  };

  const progress_callback = (raw: unknown): void => {
    const info = raw as PipelineProgressInfo;
    const file = info.file ?? info.name;
    switch (info.status) {
      case "initiate":
        if (file && !fileProgress.has(file)) fileProgress.set(file, 0);
        emit();
        break;
      case "progress":
        if (file && typeof info.progress === "number") {
          fileProgress.set(file, Math.min(99, info.progress));
          emit();
        }
        break;
      case "done":
        if (file) {
          fileProgress.set(file, 100);
          emit(true);
        }
        break;
    }
  };

  const wantWebGpu = hasWebGpu();
  if (wantWebGpu) {
    try {
      // q4f16 ≈ 4-bit weights, fp16 activations — the v3 sweet spot for WebGPU
      // Whisper. Encoder and decoder use the same dtype here for simplicity.
      const pipe = await createPipeline(
        "automatic-speech-recognition",
        modelId,
        { device: "webgpu", dtype: "q4f16", progress_callback },
      );
      pipelineDevice = "webgpu";
      pipelineModel = model;
      pipeline = wrapPipeline(pipe);
      return pipeline;
    } catch (err) {
      // Fall through to WASM below.
      // eslint-disable-next-line no-console
      console.warn("[whisper] WebGPU init failed, falling back to WASM", err);
      // Reset per-file tracking — the WASM retry below will replay all the
      // initiate/progress events. We don't want stale 100% entries from a
      // half-completed WebGPU attempt skewing the average.
      fileProgress.clear();
    }
  }

  const pipe = await createPipeline(
    "automatic-speech-recognition",
    modelId,
    { device: "wasm", dtype: "q8", progress_callback },
  );
  pipelineDevice = "wasm";
  pipelineModel = model;
  pipeline = wrapPipeline(pipe);
  return pipeline;
}

// transformers.js' pipeline returns a polymorphic value; we narrow it once.
type RawPipe = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<unknown>;

function wrapPipeline(raw: unknown): WhisperPipeline {
  const fn = raw as RawPipe;
  return async (audio, options) => {
    const result = (await fn(audio, options)) as {
      text: string;
      chunks?: { timestamp: [number, number]; text: string }[];
    };
    return result;
  };
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
  const { getPreferences } = await import("@/lib/storage/preferences");
  const prefs = await getPreferences();
  // No progress callback here — model is expected to be cached by this point
  // (Settings → Download is the only path to a fresh weight pull). If it's
  // not cached we still load it silently; the user just sees the
  // "Transcribing…" state without a download bar.
  const whisperPipeline = await loadPipeline(prefs.whisperModel);

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
        const result = await whisperPipeline(chunk, {
          return_timestamps: true,
          chunk_length_s: CHUNK_DURATION_S,
          stride_length_s: STRIDE_S,
        });
        if (result.chunks && result.chunks.length > 0) {
          for (const c of result.chunks) {
            allSegments.push({
              start: c.timestamp[0] + timeOffset,
              duration: Math.max(0, c.timestamp[1] - c.timestamp[0]),
              text: c.text.trim(),
            });
          }
        } else if (result.text.trim()) {
          allSegments.push({
            start: timeOffset,
            duration: chunk.length / SAMPLE_RATE,
            text: result.text.trim(),
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
        chrome.runtime
          .sendMessage({
            type: "transcription-error",
            error: err instanceof Error ? err.message : String(err),
          })
          .catch(() => {});
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
        break;

      case "offscreen-check-whisper":
        void (async () => {
          try {
            const keys = await self.caches.keys();
            const hasModel = keys.some((k) => k.includes("transformers"));
            chrome.runtime
              .sendMessage({
                type: "whisper-status-response",
                downloaded: hasModel,
                modelId: "whisper-tiny",
                device: pipelineDevice,
              })
              .catch(() => {});
          } catch {
            chrome.runtime
              .sendMessage({
                type: "whisper-status-response",
                downloaded: false,
                modelId: "whisper-tiny",
                device: null,
              })
              .catch(() => {});
          }
        })();
        break;

      case "offscreen-download-whisper": {
        const model = (message["model"] as "tiny" | "base") ?? "tiny";
        void (async () => {
          try {
            // Already loaded the same model? Tell the UI it's done so the
            // "Downloading…" spinner doesn't sit at 0% forever.
            if (pipeline && pipelineModel === model) {
              chrome.runtime
                .sendMessage({
                  type: "download-whisper-progress",
                  progress: 100,
                })
                .catch(() => {});
              return;
            }
            // Initial heartbeat so the UI bar shows motion even before
            // transformers.js fires its first `initiate` event.
            chrome.runtime
              .sendMessage({ type: "download-whisper-progress", progress: 1 })
              .catch(() => {});
            await loadPipeline(model, (percent) => {
              chrome.runtime
                .sendMessage({
                  type: "download-whisper-progress",
                  progress: percent,
                })
                .catch(() => {});
            });
            chrome.runtime
              .sendMessage({ type: "download-whisper-progress", progress: 100 })
              .catch(() => {});
          } catch (err) {
            // Surface the failure both as a -1 progress (so the Settings
            // UI can flip out of "downloading") and a structured error so
            // we can show the user what actually went wrong.
            chrome.runtime
              .sendMessage({ type: "download-whisper-progress", progress: -1 })
              .catch(() => {});
            chrome.runtime
              .sendMessage({
                type: "transcription-error",
                error: `Model download failed: ${err instanceof Error ? err.message : String(err)}`,
              })
              .catch(() => {});
          }
        })();
        break;
      }

      case "offscreen-delete-whisper":
        void (async () => {
          try {
            const keys = await self.caches.keys();
            for (const key of keys) {
              if (key.includes("transformers")) await self.caches.delete(key);
            }
            pipeline = null;
            pipelineDevice = null;
            pipelineModel = null;
          } catch {
            /* best effort */
          }
        })();
        break;
    }
  },
);
