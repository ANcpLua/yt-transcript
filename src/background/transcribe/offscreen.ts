export {};

// Offscreen document: captures tab audio and runs Whisper transcription.
// Communicates with service worker via chrome.runtime.sendMessage.

import type { Segment } from "@/types/transcript";

interface WhisperPipeline {
  (audio: Float32Array): Promise<{ text: string; chunks?: Array<{ timestamp: [number, number]; text: string }> }>;
}

let pipeline: WhisperPipeline | null = null;
let mediaStream: MediaStream | null = null;
let isCapturing = false;

const MODEL_MAP = {
  tiny: "onnx-community/whisper-tiny.en",
  base: "onnx-community/whisper-base.en",
} as const;

async function loadPipeline(model: "tiny" | "base"): Promise<WhisperPipeline> {
  if (pipeline) return pipeline;

  const { pipeline: createPipeline } = await import("@huggingface/transformers");
  const pipe = await createPipeline(
    "automatic-speech-recognition",
    MODEL_MAP[model],
    {
      dtype: "q8",
      device: "wasm",
    },
  );

  pipeline = (audio: Float32Array) => pipe(audio, {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  }) as Promise<{ text: string; chunks?: Array<{ timestamp: [number, number]; text: string }> }>;

  return pipeline;
}

async function captureAndTranscribe(streamId: string, videoId: string, title: string): Promise<void> {
  isCapturing = true;

  // Capture tab audio
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    } as MediaTrackConstraints,
  });
  mediaStream = stream;

  // Set up audio processing
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);

  // Record audio chunks
  const chunks: Float32Array[] = [];
  const CHUNK_DURATION = 30; // seconds
  const SAMPLE_RATE = 16000;
  const CHUNK_SAMPLES = CHUNK_DURATION * SAMPLE_RATE;

  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  let buffer = new Float32Array(0);

  processor.onaudioprocess = (e: AudioProcessingEvent) => {
    if (!isCapturing) return;
    const input = e.inputBuffer.getChannelData(0);
    const newBuffer = new Float32Array(buffer.length + input.length);
    newBuffer.set(buffer);
    newBuffer.set(input, buffer.length);
    buffer = newBuffer;

    // When we have enough audio, push a chunk
    if (buffer.length >= CHUNK_SAMPLES) {
      chunks.push(buffer.slice(0, CHUNK_SAMPLES));
      buffer = buffer.slice(CHUNK_SAMPLES);
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  // Wait for user to stop or video to end
  // Check periodically for new chunks to transcribe
  const allSegments: Segment[] = [];
  let processedChunks = 0;
  let timeOffset = 0;

  const { getPreferences } = await import("@/lib/storage/preferences");
  const prefs = await getPreferences();
  const whisperPipeline = await loadPipeline(prefs.whisperModel);

  const processLoop = setInterval(async () => {
    if (!isCapturing && chunks.length === processedChunks && buffer.length < SAMPLE_RATE) {
      clearInterval(processLoop);

      // Process remaining buffer
      if (buffer.length > SAMPLE_RATE) {
        chunks.push(buffer);
      }
    }

    while (processedChunks < chunks.length) {
      const chunk = chunks[processedChunks]!;
      processedChunks++;

      try {
        const result = await whisperPipeline(chunk);
        if (result.chunks) {
          for (const c of result.chunks) {
            allSegments.push({
              start: c.timestamp[0] + timeOffset,
              duration: c.timestamp[1] - c.timestamp[0],
              text: c.text.trim(),
            });
          }
        } else if (result.text.trim()) {
          allSegments.push({
            start: timeOffset,
            duration: CHUNK_DURATION,
            text: result.text.trim(),
          });
        }

        timeOffset += CHUNK_DURATION;

        // Send progress
        const totalExpected = Math.max(chunks.length, processedChunks);
        chrome.runtime.sendMessage({
          type: "transcription-progress",
          videoId,
          progress: Math.round((processedChunks / totalExpected) * 100),
          segments: [...allSegments],
        }).catch(() => {});
      } catch (err) {
        chrome.runtime.sendMessage({
          type: "transcription-error",
          error: err instanceof Error ? err.message : String(err),
        }).catch(() => {});
        stopCapture();
        return;
      }
    }

    // If capture stopped and all chunks processed, send complete
    if (!isCapturing && processedChunks >= chunks.length) {
      clearInterval(processLoop);
      chrome.runtime.sendMessage({
        type: "transcription-complete",
        videoId,
        title,
        segments: allSegments,
      }).catch(() => {});
    }
  }, 2000);
}

function stopCapture(): void {
  isCapturing = false;
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
    mediaStream = null;
  }
}

// Handle messages from service worker
chrome.runtime.onMessage.addListener((message: { type: string; [key: string]: unknown }) => {
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

    case "offscreen-check-whisper": {
      // Check if model exists in cache by trying to access IndexedDB
      void (async () => {
        try {
          const caches = await self.caches.keys();
          const hasModel = caches.some((k) => k.includes("transformers"));
          chrome.runtime.sendMessage({
            type: "whisper-status-response",
            downloaded: hasModel,
            modelId: "whisper-tiny",
          }).catch(() => {});
        } catch {
          chrome.runtime.sendMessage({
            type: "whisper-status-response",
            downloaded: false,
            modelId: "whisper-tiny",
          }).catch(() => {});
        }
      })();
      break;
    }

    case "offscreen-download-whisper": {
      const model = (message["model"] as "tiny" | "base") ?? "tiny";
      void (async () => {
        try {
          await loadPipeline(model);
          chrome.runtime.sendMessage({
            type: "download-whisper-progress",
            progress: 100,
          }).catch(() => {});
        } catch (err) {
          chrome.runtime.sendMessage({
            type: "transcription-error",
            error: `Model download failed: ${err instanceof Error ? err.message : String(err)}`,
          }).catch(() => {});
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
        } catch { /* best effort */ }
      })();
      break;
  }
});
