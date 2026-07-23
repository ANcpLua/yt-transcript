// AudioWorklet processor for tab-capture audio. Replaces the deprecated
// ScriptProcessorNode. Lives in a separate worklet bundle because the
// `audioWorklet.addModule()` API loads a JS file into a dedicated thread.
// Posts mono Float32 frames back to the main offscreen thread which
// accumulates them for Chrome's on-device transcription model.
//
// Compiled to dist/offscreen/worklet-processor.js (esbuild IIFE).

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(
  name: string,
  ctor: new () => AudioWorkletProcessor,
): void;

class AudioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      const samples = channel.slice();
      this.port.postMessage(samples, [samples.buffer]);
    }
    return true;
  }
}

registerProcessor("audio-capture", AudioCaptureProcessor);

export {};
