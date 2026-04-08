import type { Segment } from "@/types/transcript";

const TIMESTAMP_RE = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

function parseTimestamp(ts: string): number {
  const m = TIMESTAMP_RE.exec(ts);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/**
 * Parse a WebVTT string into Segment[].
 * Handles standard VTT with optional STYLE/NOTE blocks.
 */
export function parseVtt(vtt: string): Segment[] {
  const segments: Segment[] = [];
  const lines = vtt.split(/\r?\n/);
  let i = 0;

  // Skip WEBVTT header and any metadata
  while (i < lines.length && !lines[i]!.includes("-->")) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i]!;

    // Look for timestamp lines: "00:00:01.000 --> 00:00:04.000"
    const arrowIdx = line.indexOf("-->");
    if (arrowIdx === -1) {
      i++;
      continue;
    }

    const startStr = line.slice(0, arrowIdx).trim();
    const endPart = line.slice(arrowIdx + 3).trim();
    // End timestamp may have position/alignment settings after it
    const endStr = endPart.split(/\s/)[0] ?? endPart;

    const start = parseTimestamp(startStr);
    const end = parseTimestamp(endStr);
    i++;

    // Collect cue text lines until blank line or end
    const textLines: string[] = [];
    while (i < lines.length && lines[i]!.trim().length > 0) {
      // Strip VTT tags like <v Speaker>, <b>, <i>, etc.
      const cleaned = lines[i]!.replace(/<[^>]+>/g, "").trim();
      if (cleaned.length > 0) textLines.push(cleaned);
      i++;
    }

    const text = textLines.join(" ").trim();
    if (text.length > 0) {
      segments.push({
        start,
        duration: Math.max(end - start, 0),
        text,
      });
    }
  }

  return segments;
}
