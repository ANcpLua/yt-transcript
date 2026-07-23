const REFUSAL_PATTERN =
  /(?:i (?:cannot|can't|am unable to)|not able to transcribe|can't transcribe|cannot transcribe|audio clips?|anything else i can help|as an ai)/i;

export function isSilentPcm(pcm: Float32Array, threshold: number): boolean {
  if (pcm.length === 0) return true;
  let energy = 0;
  for (const sample of pcm) energy += sample * sample;
  return Math.sqrt(energy / pcm.length) < threshold;
}

export function sanitizeTranscription(value: string): string {
  const text = value.trim();
  return REFUSAL_PATTERN.test(text) ? "" : text;
}
