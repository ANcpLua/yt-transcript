// Parser for the youtubei/v1/get_transcript response shape. YouTube
// has used at least two structures for this endpoint over the years;
// we try both. Output is the same Segment[] shape the rest of the
// app already consumes from the legacy /api/timedtext path.

import type { Segment } from "@/types/transcript";

interface RunsText {
  runs?: { text?: string }[];
  simpleText?: string;
}

function readText(t: RunsText | undefined): string {
  if (!t) return "";
  if (typeof t.simpleText === "string") return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r?.text ?? "").join("");
  return "";
}

function readMs(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function pluckRenderer(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null) return null;
  const root = parsed as Record<string, unknown>;
  const actions = Array.isArray(root["actions"]) ? root["actions"] : [];
  for (const action of actions) {
    if (typeof action !== "object" || action === null) continue;
    const upd = (action as Record<string, unknown>)["updateEngagementPanelAction"];
    if (typeof upd !== "object" || upd === null) continue;
    const content = (upd as Record<string, unknown>)["content"];
    if (typeof content !== "object" || content === null) continue;
    const tr = (content as Record<string, unknown>)["transcriptRenderer"];
    if (typeof tr === "object" && tr !== null) return tr;
  }
  return null;
}

function dig<T = unknown>(obj: unknown, ...keys: string[]): T | undefined {
  let cur: unknown = obj;
  for (const k of keys) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur as T | undefined;
}

// Newer shape: actions[].updateEngagementPanelAction.content.transcriptRenderer
//   .content.transcriptSearchPanelRenderer.body.transcriptSegmentListRenderer.initialSegments[]
//   .transcriptSegmentRenderer { snippet, startMs, endMs }
function parseSegmentList(renderer: unknown): Segment[] {
  const segments = dig<unknown[]>(
    renderer,
    "content",
    "transcriptSearchPanelRenderer",
    "body",
    "transcriptSegmentListRenderer",
    "initialSegments",
  );
  if (!Array.isArray(segments)) return [];

  const out: Segment[] = [];
  for (const s of segments) {
    const r = dig<Record<string, unknown>>(s, "transcriptSegmentRenderer");
    if (!r) continue;
    const snippet = r["snippet"] as RunsText | undefined;
    const text = readText(snippet).trim();
    if (text.length === 0) continue;
    const startMs = readMs(r["startMs"]);
    const endMs = readMs(r["endMs"]);
    out.push({
      start: startMs / 1000,
      duration: Math.max(0, endMs - startMs) / 1000,
      text,
    });
  }
  return out;
}

// Older shape: ...transcriptRenderer.body.transcriptBodyRenderer.cueGroups[]
//   .transcriptCueGroupRenderer.cues[].transcriptCueRenderer { cue, startOffsetMs, durationMs }
function parseCueGroups(renderer: unknown): Segment[] {
  const groups = dig<unknown[]>(
    renderer,
    "body",
    "transcriptBodyRenderer",
    "cueGroups",
  );
  if (!Array.isArray(groups)) return [];

  const out: Segment[] = [];
  for (const g of groups) {
    const cues = dig<unknown[]>(g, "transcriptCueGroupRenderer", "cues");
    if (!Array.isArray(cues)) continue;
    for (const c of cues) {
      const r = dig<Record<string, unknown>>(c, "transcriptCueRenderer");
      if (!r) continue;
      const cue = r["cue"] as RunsText | undefined;
      const text = readText(cue).trim();
      if (text.length === 0) continue;
      out.push({
        start: readMs(r["startOffsetMs"]) / 1000,
        duration: readMs(r["durationMs"]) / 1000,
        text,
      });
    }
  }
  return out;
}

export function parseGetTranscript(bodyText: string): Segment[] {
  if (!bodyText.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return [];
  }
  const renderer = pluckRenderer(parsed);
  if (!renderer) return [];
  const a = parseSegmentList(renderer);
  if (a.length > 0) return a;
  return parseCueGroups(renderer);
}

// Extract the videoId from the request body of get_transcript / player.
// player: { context, videoId: "..." }
// get_transcript: { context, params: base64(protobuf({1: videoId})) }
export function extractVideoIdFromRequest(requestBody: string): string | null {
  if (!requestBody) return null;
  let body: unknown;
  try {
    body = JSON.parse(requestBody);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const obj = body as Record<string, unknown>;

  if (typeof obj["videoId"] === "string") return obj["videoId"];

  const params = obj["params"];
  if (typeof params !== "string") return null;
  try {
    const raw = atob(params);
    // Field 1 (string) protobuf encoding: 0x0A <varint length> <bytes>.
    if (raw.length < 2 || raw.charCodeAt(0) !== 0x0a) return null;
    const len = raw.charCodeAt(1);
    if (len < 8 || len > 16 || raw.length < 2 + len) return null;
    const candidate = raw.slice(2, 2 + len);
    return /^[A-Za-z0-9_-]{8,16}$/.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
