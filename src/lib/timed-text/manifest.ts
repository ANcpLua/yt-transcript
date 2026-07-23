import type { TimedTextFormat } from "./detect";

export interface ManifestResource {
  url: string;
  format: TimedTextFormat;
  language?: string;
  label?: string;
}

export interface ManifestInspection {
  resources: ManifestResource[];
  hasInBandCaptions: boolean;
  hasUnsupportedSegments: boolean;
}

function resolveUrl(value: string, baseUrl: string): string | null {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function parseAttributeList(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/(?:^|,)([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/gi)) {
    const key = match[1]?.toUpperCase();
    const item = match[2] ?? match[3];
    if (key && item !== undefined) attributes[key] = item.trim();
  }
  return attributes;
}

function formatFromMimeOrCodec(mimeType: string, codecs: string): TimedTextFormat {
  const normalizedMime = mimeType.toLowerCase();
  const normalizedCodecs = codecs.toLowerCase();
  if (normalizedMime.includes("vtt") || normalizedCodecs.includes("wvtt")) return "webvtt";
  if (
    normalizedMime.includes("ttml")
    || normalizedCodecs.includes("stpp")
    || normalizedCodecs.includes("ttml")
  ) {
    return "ttml";
  }
  if (
    normalizedMime.includes("mp4")
    || normalizedCodecs.includes("tx3g")
    || normalizedCodecs.includes("c608")
    || normalizedCodecs.includes("c708")
  ) {
    return "mp4";
  }
  return "unknown";
}

export function inspectHlsManifest(
  body: string,
  baseUrl: string,
  assumeSubtitlePlaylist = false,
): ManifestInspection {
  const resources: ManifestResource[] = [];
  let hasInBandCaptions = false;
  let hasUnsupportedSegments = false;

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#EXT-X-MEDIA:")) {
      const attributes = parseAttributeList(trimmed.slice("#EXT-X-MEDIA:".length));
      if (attributes["TYPE"] === "CLOSED-CAPTIONS") {
        hasInBandCaptions = true;
        continue;
      }
      if (attributes["TYPE"] !== "SUBTITLES" || !attributes["URI"]) continue;
      const url = resolveUrl(attributes["URI"], baseUrl);
      if (!url) continue;
      resources.push({
        url,
        format: "hls",
        ...(attributes["LANGUAGE"] ? { language: attributes["LANGUAGE"] } : {}),
        ...(attributes["NAME"] ? { label: attributes["NAME"] } : {}),
      });
      continue;
    }
    if (trimmed.startsWith("#EXT-X-STREAM-INF:")) {
      const attributes = parseAttributeList(trimmed.slice("#EXT-X-STREAM-INF:".length));
      if (attributes["CLOSED-CAPTIONS"] && attributes["CLOSED-CAPTIONS"] !== "NONE") {
        hasInBandCaptions = true;
      }
      continue;
    }
    if (!trimmed || trimmed.startsWith("#")) continue;
    const url = resolveUrl(trimmed, baseUrl);
    if (!url) continue;
    const lower = url.toLowerCase();
    if (
      lower.includes(".vtt")
      || lower.includes("subtitle")
      || lower.includes("caption")
      || assumeSubtitlePlaylist
    ) {
      resources.push({ url, format: "webvtt" });
    } else if (lower.includes(".m4s") || lower.includes(".mp4")) {
      hasUnsupportedSegments = true;
    }
  }

  return { resources, hasInBandCaptions, hasUnsupportedSegments };
}

function readAttribute(value: string, name: string): string {
  return new RegExp(`\\b${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')`, "i")
    .exec(value)?.slice(1).find((part): part is string => typeof part === "string") ?? "";
}

export function inspectDashManifest(body: string, baseUrl: string): ManifestInspection {
  const resources: ManifestResource[] = [];
  let hasInBandCaptions = false;
  let hasUnsupportedSegments = false;

  for (const adaptation of body.matchAll(/<(?:\w+:)?AdaptationSet\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?AdaptationSet\s*>/gi)) {
    const attrs = adaptation[1] ?? "";
    const content = adaptation[2] ?? "";
    const contentType = readAttribute(attrs, "contentType");
    const adaptationMime = readAttribute(attrs, "mimeType");
    const adaptationCodecs = readAttribute(attrs, "codecs");
    const language = readAttribute(attrs, "lang");
    const role = /<(?:\w+:)?Role\b[^>]*\bvalue\s*=\s*["']([^"']+)["']/i.exec(content)?.[1] ?? "";
    const isText = contentType.toLowerCase() === "text"
      || /(?:vtt|ttml|subtitle|caption|stpp|wvtt|tx3g|c608|c708)/i.test(
        `${adaptationMime} ${adaptationCodecs} ${role}`,
      );
    if (!isText) continue;

    const representations = [...content.matchAll(/<(?:\w+:)?Representation\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Representation\s*>/gi)];
    const blocks = representations.length > 0
      ? representations.map((match) => ({ attrs: match[1] ?? "", body: match[2] ?? "" }))
      : [{ attrs, body: content }];

    for (const block of blocks) {
      const mime = readAttribute(block.attrs, "mimeType") || adaptationMime;
      const codecs = readAttribute(block.attrs, "codecs") || adaptationCodecs;
      const format = formatFromMimeOrCodec(mime, codecs);
      if (/c608|c708/i.test(codecs)) hasInBandCaptions = true;
      const base = /<(?:\w+:)?BaseURL\b[^>]*>([^<]+)<\/(?:\w+:)?BaseURL\s*>/i.exec(block.body)?.[1]?.trim();
      if (base) {
        const url = resolveUrl(base, baseUrl);
        if (url) {
          resources.push({
            url,
            format,
            ...(language ? { language } : {}),
            ...(role ? { label: role } : {}),
          });
        }
      }
      if (/<(?:\w+:)?SegmentTemplate\b|<(?:\w+:)?SegmentList\b/i.test(block.body)) {
        hasUnsupportedSegments = true;
      }
    }
  }

  return { resources, hasInBandCaptions, hasUnsupportedSegments };
}

export function inspectManifest(
  body: string,
  baseUrl: string,
  format: TimedTextFormat,
  assumeSubtitlePlaylist = false,
): ManifestInspection {
  if (format === "hls") return inspectHlsManifest(body, baseUrl, assumeSubtitlePlaylist);
  if (format === "dash") return inspectDashManifest(body, baseUrl);
  return { resources: [], hasInBandCaptions: false, hasUnsupportedSegments: false };
}
