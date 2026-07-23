export const TIMED_TEXT_URL_MARKERS = [
  ".vtt",
  ".srt",
  ".ttml",
  ".dfxp",
  ".itt",
  ".ass",
  ".ssa",
  ".smi",
  ".sami",
  ".sbv",
  ".sub",
  ".mpsub",
  ".lrc",
  ".mpl2",
  ".rt",
  ".scc",
  ".mcc",
  ".stl",
  ".cap",
  ".tds",
  ".pac",
  ".sup",
  ".idx",
  ".xml",
  ".json",
  ".m3u8",
  ".mpd",
  ".m4s",
  ".mp4",
  "timedtext",
  "texttrack",
  "text-track",
  "subtitle",
  "subtitles",
  "caption",
  "captions",
  "closedcaption",
  "closed-caption",
  "transcript",
] as const;

export const TIMED_TEXT_MIME_TYPES = [
  "text/vtt",
  "application/ttml+xml",
  "application/vnd.dece.ttml+xml",
  "video/3gpp-tt",
  "application/x-subrip",
  "text/srt",
  "application/srt",
  "text/x-ass",
  "text/x-ssa",
  "application/x-sami",
  "application/dash+xml",
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/mp4",
  "video/mp4",
  "application/json",
  "application/xml",
  "text/xml",
  "image/vnd.dvb.subtitle",
] as const;

export type TimedTextFormat =
  | "webvtt"
  | "srt"
  | "ttml"
  | "ass"
  | "ssa"
  | "sami"
  | "sbv"
  | "lrc"
  | "json"
  | "hls"
  | "dash"
  | "mp4"
  | "bitmap"
  | "unknown";

export interface TimedTextCandidateClassification {
  matched: boolean;
  format: TimedTextFormat;
  inspectBody: boolean;
  urlMatched: boolean;
  mimeMatched: boolean;
}

const MIME_FORMATS: Readonly<Record<string, TimedTextFormat>> = {
  "text/vtt": "webvtt",
  "application/ttml+xml": "ttml",
  "application/vnd.dece.ttml+xml": "ttml",
  "video/3gpp-tt": "mp4",
  "application/x-subrip": "srt",
  "text/srt": "srt",
  "application/srt": "srt",
  "text/x-ass": "ass",
  "text/x-ssa": "ssa",
  "application/x-sami": "sami",
  "application/dash+xml": "dash",
  "application/vnd.apple.mpegurl": "hls",
  "application/x-mpegurl": "hls",
  "application/mp4": "mp4",
  "video/mp4": "mp4",
  "application/json": "json",
  "application/xml": "ttml",
  "text/xml": "ttml",
  "image/vnd.dvb.subtitle": "bitmap",
};

const EXTENSION_FORMATS: ReadonlyArray<readonly [string, TimedTextFormat]> = [
  [".vtt", "webvtt"],
  [".srt", "srt"],
  [".ttml", "ttml"],
  [".dfxp", "ttml"],
  [".itt", "ttml"],
  [".ass", "ass"],
  [".ssa", "ssa"],
  [".smi", "sami"],
  [".sami", "sami"],
  [".sbv", "sbv"],
  [".lrc", "lrc"],
  [".m3u8", "hls"],
  [".mpd", "dash"],
  [".m4s", "mp4"],
  [".mp4", "mp4"],
  [".sup", "bitmap"],
  [".idx", "bitmap"],
  [".json", "json"],
  [".xml", "ttml"],
];

const BODY_INSPECTABLE = new Set<TimedTextFormat>([
  "webvtt",
  "srt",
  "ttml",
  "ass",
  "ssa",
  "sami",
  "sbv",
  "lrc",
  "json",
  "hls",
  "dash",
  "unknown",
]);

export function normalizeMimeType(value: string | null | undefined): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function formatFromUrl(url: string): TimedTextFormat {
  const lower = url.toLowerCase();
  for (const [marker, format] of EXTENSION_FORMATS) {
    if (lower.includes(marker)) return format;
  }
  return "unknown";
}

export function classifyTimedTextCandidate(
  url: string,
  mimeType?: string | null,
): TimedTextCandidateClassification {
  const lowerUrl = url.toLowerCase();
  const mime = normalizeMimeType(mimeType);
  const urlMatched = TIMED_TEXT_URL_MARKERS.some((marker) => lowerUrl.includes(marker));
  const mimeMatched = TIMED_TEXT_MIME_TYPES.includes(
    mime as (typeof TIMED_TEXT_MIME_TYPES)[number],
  );
  const mimeFormat = MIME_FORMATS[mime];
  const format = mimeFormat ?? formatFromUrl(url);

  return {
    matched: urlMatched || mimeMatched,
    format,
    inspectBody: BODY_INSPECTABLE.has(format),
    urlMatched,
    mimeMatched,
  };
}

export function sniffTimedTextFormat(body: string): TimedTextFormat {
  const sample = body.trimStart().slice(0, 4096);
  const upper = sample.toUpperCase();
  if (upper.startsWith("WEBVTT")) return "webvtt";
  if (upper.startsWith("#EXTM3U")) return "hls";
  if (/^<\?xml\b/i.test(sample) || /^<(?:\w+:)?tt[\s>]/i.test(sample)) {
    return /<(?:\w+:)?mpd[\s>]/i.test(sample) ? "dash" : "ttml";
  }
  if (/^<(?:\w+:)?mpd[\s>]/i.test(sample)) return "dash";
  if (/^\[(?:script info|v4\+? styles|events)\]/im.test(sample)) return "ass";
  if (/<sami[\s>]/i.test(sample) || /<sync\s+start=/i.test(sample)) return "sami";
  if (/^\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/m.test(sample)) return "lrc";
  if (/^\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->/m.test(sample)) {
    return sample.includes(",") ? "srt" : "webvtt";
  }
  if (/^\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s*,\s*\d/m.test(sample)) return "sbv";
  if (sample.startsWith("{") || sample.startsWith("[")) return "json";
  return "unknown";
}
