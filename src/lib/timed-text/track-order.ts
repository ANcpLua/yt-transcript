/**
 * Default track choice for a page with several text tracks. Language comes
 * first: the page's own language, then a language the browser is set to,
 * then English. Only inside one language tier do the track's role, origin
 * and length decide. Without this a longer subtitle file in another
 * language won the default (a talk page in English opened in Portuguese).
 */
export interface OrderedTrack {
  language: string;
  label: string;
  kind: string;
  source: "page-track" | "network-resource";
  segments: readonly unknown[];
}

export interface LanguageContext {
  pageLanguage: string;
  browserLanguages: readonly string[];
}

/** Primary subtag, lower case: "pt-BR" and "pt_br" both give "pt". */
export function primaryLanguage(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

function sameLanguage(left: string, right: string): boolean {
  const a = primaryLanguage(left);
  const b = primaryLanguage(right);
  return a !== "" && a !== "und" && a === b;
}

/** 3 for the page language, 2 for a browser language, 1 for English, 0 otherwise. */
export function languageTier(language: string, context: LanguageContext): number {
  if (sameLanguage(language, context.pageLanguage)) return 3;
  if (context.browserLanguages.some((candidate) => sameLanguage(language, candidate))) return 2;
  if (primaryLanguage(language) === "en") return 1;
  return 0;
}

export function rankTrack(track: OrderedTrack): number {
  const role = /^(?:subtitles|captions)$/i.test(track.kind) ? 1_000_000 : 0;
  const runtime = track.source === "page-track" ? 100_000 : 0;
  return role + runtime + track.segments.length;
}

export function semanticTrackKey(track: OrderedTrack): string {
  return `${track.language}\u0000${track.label}\u0000${track.kind}`;
}

/** Sort comparator: best default track first. Deterministic for equal tracks. */
export function compareTracks(left: OrderedTrack, right: OrderedTrack, context: LanguageContext): number {
  return languageTier(right.language, context) - languageTier(left.language, context)
    || rankTrack(right) - rankTrack(left)
    || semanticTrackKey(left).localeCompare(semanticTrackKey(right));
}

/** Languages the browser is set to, from the worker's navigator when there is one. */
export function browserLanguages(
  nav: { languages?: readonly string[]; language?: string } | null | undefined = globalThis.navigator,
): string[] {
  if (!nav) return [];
  if (Array.isArray(nav.languages) && nav.languages.length > 0) return [...nav.languages];
  return nav.language ? [nav.language] : [];
}
