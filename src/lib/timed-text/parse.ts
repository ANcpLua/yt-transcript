import type { Segment } from "../../types/transcript";
import {
  sniffTimedTextFormat,
  type TimedTextFormat,
} from "./detect";

export interface ParsedTimedText {
  format: TimedTextFormat;
  segments: Segment[];
}

interface ParseHint {
  format?: TimedTextFormat;
  mimeType?: string;
  url?: string;
}

const ENTITY_MAP: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity.startsWith("#x")) {
        const codePoint = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      if (entity.startsWith("#")) {
        const codePoint = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      return ENTITY_MAP[entity.toLowerCase()] ?? match;
    },
  );
}

function cleanCueText(value: string): string {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\{\\[^}]*}/g, "")
      .replace(/\\[Nn]/g, "\n"),
  )
    .replace(/\u200b/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function parseClockTimestamp(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length === 1 ? Number(parts[0]) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function parseTtmlTime(
  value: string,
  frameRate: number,
  tickRate: number,
): number | null {
  const frameClock = /^(\d+):(\d{2}):(\d{2}):(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (frameClock) {
    const hours = Number(frameClock[1]);
    const minutes = Number(frameClock[2]);
    const seconds = Number(frameClock[3]);
    const frames = Number(frameClock[4]);
    if ([hours, minutes, seconds, frames].every(Number.isFinite)) {
      return hours * 3600 + minutes * 60 + seconds + frames / frameRate;
    }
  }
  const clock = parseClockTimestamp(value);
  if (clock !== null) return clock;
  const offset = /^(-?\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/.exec(value.trim());
  if (!offset) return null;
  const amount = Number(offset[1]);
  if (!Number.isFinite(amount)) return null;
  switch (offset[2]) {
    case "h": return amount * 3600;
    case "m": return amount * 60;
    case "s": return amount;
    case "ms": return amount / 1000;
    case "f": return amount / frameRate;
    case "t": return amount / tickRate;
  }
  return null;
}

function normalizeSegments(segments: Segment[]): Segment[] {
  const seen = new Set<string>();
  const normalized = segments
    .filter((segment) => (
      Number.isFinite(segment.start)
      && Number.isFinite(segment.duration)
      && segment.start >= 0
      && segment.duration >= 0
    ))
    .map((segment) => ({
      start: segment.start,
      duration: segment.duration,
      text: cleanCueText(segment.text),
    }))
    .filter((segment) => segment.text.length > 0)
    .sort((left, right) => left.start - right.start)
    .filter((segment) => {
      const key = `${segment.start.toFixed(3)}\u0000${segment.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  for (let index = 0; index < normalized.length; index++) {
    const segment = normalized[index];
    const next = normalized[index + 1];
    if (segment && segment.duration === 0 && next && next.start > segment.start) {
      segment.duration = next.start - segment.start;
    }
  }
  return normalized;
}

function parseArrowCues(body: string): Segment[] {
  const blocks = body.replace(/^\uFEFF/, "").split(/\r?\n\r?\n+/);
  const segments: Segment[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex];
    if (!timing) continue;
    const match = /^\s*(\S+)\s*-->\s*(\S+)/.exec(timing);
    if (!match?.[1] || !match[2]) continue;
    const start = parseClockTimestamp(match[1]);
    const end = parseClockTimestamp(match[2]);
    if (start === null || end === null || end < start) continue;
    segments.push({
      start,
      duration: end - start,
      text: lines.slice(timingIndex + 1).join("\n"),
    });
  }
  return normalizeSegments(segments);
}

function parseSbv(body: string): Segment[] {
  const segments: Segment[] = [];
  for (const block of body.split(/\r?\n\r?\n+/)) {
    const lines = block.split(/\r?\n/);
    const timing = lines[0]?.split(",");
    if (!timing?.[0] || !timing[1]) continue;
    const start = parseClockTimestamp(timing[0]);
    const end = parseClockTimestamp(timing[1]);
    if (start === null || end === null || end < start) continue;
    segments.push({
      start,
      duration: end - start,
      text: lines.slice(1).join("\n"),
    });
  }
  return normalizeSegments(segments);
}

function parseAss(body: string): Segment[] {
  const segments: Segment[] = [];
  let fields = [
    "layer",
    "start",
    "end",
    "style",
    "name",
    "marginl",
    "marginr",
    "marginv",
    "effect",
    "text",
  ];
  let inEvents = false;

  for (const line of body.split(/\r?\n/)) {
    if (/^\[events\]\s*$/i.test(line)) {
      inEvents = true;
      continue;
    }
    if (/^\[/.test(line)) {
      inEvents = false;
      continue;
    }
    if (!inEvents) continue;
    const formatMatch = /^format\s*:\s*(.+)$/i.exec(line);
    if (formatMatch?.[1]) {
      fields = formatMatch[1].split(",").map((field) => field.trim().toLowerCase());
      continue;
    }
    const dialogue = /^dialogue\s*:\s*(.+)$/i.exec(line);
    if (!dialogue?.[1]) continue;
    const values = dialogue[1].split(",");
    if (values.length < fields.length) continue;
    const textIndex = fields.indexOf("text");
    const startIndex = fields.indexOf("start");
    const endIndex = fields.indexOf("end");
    if (textIndex < 0 || startIndex < 0 || endIndex < 0) continue;
    const start = parseClockTimestamp(values[startIndex] ?? "");
    const end = parseClockTimestamp(values[endIndex] ?? "");
    if (start === null || end === null || end < start) continue;
    segments.push({
      start,
      duration: end - start,
      text: values.slice(textIndex).join(","),
    });
  }
  return normalizeSegments(segments);
}

function parseSami(body: string): Segment[] {
  const matches = [...body.matchAll(/<sync\b[^>]*\bstart\s*=\s*["']?(\d+)[^>]*>([\s\S]*?)(?=<sync\b|<\/body>|$)/gi)];
  const segments: Segment[] = [];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const startMs = Number(match?.[1]);
    const nextStartMs = Number(matches[index + 1]?.[1]);
    if (!Number.isFinite(startMs)) continue;
    segments.push({
      start: startMs / 1000,
      duration: Number.isFinite(nextStartMs) ? Math.max(0, nextStartMs - startMs) / 1000 : 0,
      text: match?.[2] ?? "",
    });
  }
  return normalizeSegments(segments);
}

function parseLrc(body: string): Segment[] {
  const segments: Segment[] = [];
  for (const line of body.split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]/g)];
    const text = line.replace(/\[[^\]]+]/g, "").trim();
    if (!text) continue;
    for (const tag of tags) {
      const minutes = Number(tag[1]);
      const seconds = Number(tag[2]);
      const fractionText = tag[3] ?? "";
      const fraction = fractionText
        ? Number(fractionText) / (10 ** fractionText.length)
        : 0;
      segments.push({
        start: minutes * 60 + seconds + fraction,
        duration: 0,
        text,
      });
    }
  }
  return normalizeSegments(segments);
}

function readXmlAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')`, "i").exec(tag);
  return match?.[1] ?? match?.[2] ?? null;
}

function parseTtml(body: string): Segment[] {
  const rootTag = /<(?:\w+:)?tt\b[^>]*>/i.exec(body)?.[0] ?? "";
  const frameRate = Number(readXmlAttribute(rootTag, "(?:ttp:)?frameRate") ?? "30");
  const tickRate = Number(readXmlAttribute(rootTag, "(?:ttp:)?tickRate") ?? "1");
  const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const safeTickRate = Number.isFinite(tickRate) && tickRate > 0 ? tickRate : 1;
  const segments: Segment[] = [];

  for (const match of body.matchAll(/<(?:\w+:)?p\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?p\s*>/gi)) {
    const attrs = match[1] ?? "";
    const beginValue = readXmlAttribute(attrs, "begin");
    if (!beginValue) continue;
    const start = parseTtmlTime(beginValue, safeFrameRate, safeTickRate);
    if (start === null) continue;
    const endValue = readXmlAttribute(attrs, "end");
    const durationValue = readXmlAttribute(attrs, "dur");
    const end = endValue
      ? parseTtmlTime(endValue, safeFrameRate, safeTickRate)
      : null;
    const duration = durationValue
      ? parseTtmlTime(durationValue, safeFrameRate, safeTickRate)
      : null;
    segments.push({
      start,
      duration: end !== null ? Math.max(0, end - start) : Math.max(0, duration ?? 0),
      text: match[2] ?? "",
    });
  }
  return normalizeSegments(segments);
}

function numberAt(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
  }
  return null;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textValue).join("");
  if (typeof value !== "object" || value === null) return "";
  const record = value as Record<string, unknown>;
  for (const key of ["text", "utf8", "simpleText", "runs"]) {
    const text = textValue(record[key]);
    if (text.trim()) return text;
  }
  return "";
}

function stringAt(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const text = textValue(record[key]);
    if (text.trim()) return text;
  }
  return null;
}

function parseJson(body: string): Segment[] {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return [];
  }

  const segments: Segment[] = [];
  const queue: unknown[] = [root];
  const visited = new Set<object>();
  let cursor = 0;
  let inspected = 0;

  while (cursor < queue.length && inspected < 50_000) {
    const value = queue[cursor++];
    inspected++;
    if (Array.isArray(value)) {
      queue.push(...value.slice(0, 20_000));
      continue;
    }
    if (typeof value !== "object" || value === null || visited.has(value)) continue;
    visited.add(value);
    const record = value as Record<string, unknown>;
    const text = stringAt(record, [
      "text",
      "utf8",
      "caption",
      "subtitle",
      "cue",
      "snippet",
      "payload",
      "segs",
    ]);
    const startMs = numberAt(record, [
      "tStartMs",
      "startMs",
      "start_ms",
      "startOffsetMs",
      "offsetMs",
    ]);
    const startSeconds = numberAt(record, ["start", "startTime", "start_time", "offset"]);
    const endMs = numberAt(record, ["endMs", "end_ms"]);
    const endSeconds = numberAt(record, ["end", "endTime", "end_time"]);
    const durationMs = numberAt(record, ["dDurationMs", "durationMs", "duration_ms"]);
    const durationSeconds = numberAt(record, ["duration", "dur"]);
    const start = startMs !== null ? startMs / 1000 : startSeconds;

    if (text && start !== null) {
      const duration = durationMs !== null
        ? durationMs / 1000
        : durationSeconds !== null
          ? durationSeconds
          : endMs !== null
            ? Math.max(0, endMs / 1000 - start)
            : endSeconds !== null
              ? Math.max(0, endSeconds - start)
              : 0;
      segments.push({ start, duration, text });
    }

    for (const child of Object.values(record)) {
      if (typeof child === "object" && child !== null) queue.push(child);
    }
  }
  return normalizeSegments(segments);
}

function parseByFormat(body: string, format: TimedTextFormat): Segment[] {
  switch (format) {
    case "webvtt":
    case "srt":
      return parseArrowCues(body);
    case "ttml":
      return parseTtml(body);
    case "ass":
    case "ssa":
      return parseAss(body);
    case "sami":
      return parseSami(body);
    case "sbv":
      return parseSbv(body);
    case "lrc":
      return parseLrc(body);
    case "json":
      return parseJson(body);
    default:
      return [];
  }
}

export function parseTimedText(body: string, hint: ParseHint = {}): ParsedTimedText {
  const sniffed = sniffTimedTextFormat(body);
  const formats = [...new Set<TimedTextFormat>([
    sniffed,
    hint.format ?? "unknown",
    hint.mimeType?.includes("json") ? "json" : "unknown",
    hint.url?.toLowerCase().includes(".sbv") ? "sbv" : "unknown",
  ])].filter((format) => format !== "unknown");

  for (const format of formats) {
    const segments = parseByFormat(body, format);
    if (segments.length > 0) return { format, segments };
  }
  return { format: sniffed !== "unknown" ? sniffed : hint.format ?? "unknown", segments: [] };
}
