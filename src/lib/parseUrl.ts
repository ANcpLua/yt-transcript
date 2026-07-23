const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const DOMAIN_LIKE_RE = /^(?:[^.\s/]+\.)+[^.\s/]+(?:[/?#]|$)/;

const PATTERNS: readonly RegExp[] = [
    // youtube.com/watch?v=ID (standard, mobile, www, music)
    /(?:https?:\/\/)?(?:www\.|m\.|music\.)?youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    // youtu.be/ID (short share links)
    /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    // youtube.com/shorts/ID
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    // youtube.com/embed/ID
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    // youtube.com/v/ID (old embed format)
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    // youtube.com/live/ID
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
];

const PLAYLIST_PATTERNS: readonly RegExp[] = [
    // youtube.com/playlist?list=PLxxxx
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/playlist\?.*list=(PL[a-zA-Z0-9_-]+)/,
    // youtube.com/watch?v=xxx&list=PLxxxx
    /(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/watch\?.*list=(PL[a-zA-Z0-9_-]+)/,
];

const CHANNEL_PATTERNS: readonly RegExp[] = [
    // youtube.com/@handle
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/(@[a-zA-Z0-9_.-]+)/,
    // youtube.com/channel/UCxxx
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/,
    // youtube.com/c/name
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/c\/([a-zA-Z0-9_-]+)/,
];

export function parseVideoId(input: string): string | null {
    const trimmed = input.trim();

    if (trimmed.length === 0) {
        return null;
    }

    // Check for bare 11-character YouTube video ID
    if (VIDEO_ID_RE.test(trimmed)) {
        return trimmed;
    }

    for (const pattern of PATTERNS) {
        const match = pattern.exec(trimmed);
        if (match?.[1]) {
            return match[1];
        }
    }

    return null;
}

export function parsePlaylistId(input: string): string | null {
    const trimmed = input.trim();
    for (const pattern of PLAYLIST_PATTERNS) {
        const match = pattern.exec(trimmed);
        if (match?.[1]) return match[1];
    }
    return null;
}

export function parseChannelHandle(input: string): string | null {
    const trimmed = input.trim();
    for (const pattern of CHANNEL_PATTERNS) {
        const match = pattern.exec(trimmed);
        if (match?.[1]) return match[1];
    }
    return null;
}

export type ParsedUrl =
    | { platform: "youtube"; type: "video"; videoId: string }
    | { platform: "youtube"; type: "playlist"; playlistId: string }
    | { platform: "youtube"; type: "channel"; handle: string }
    | { type: "web"; url: string };

export function parseWebUrl(input: string): string | null {
    const trimmed = input.trim().replaceAll("&amp;", "&");
    if (trimmed.length === 0) return null;

    const candidate = URL_SCHEME_RE.test(trimmed)
        ? trimmed
        : DOMAIN_LIKE_RE.test(trimmed)
            ? `https://${trimmed}`
            : null;
    if (!candidate) return null;

    try {
        const url = new URL(candidate);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        return url.href;
    } catch {
        return null;
    }
}

export function parseUrl(input: string): ParsedUrl | null {
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;

    // YouTube playlist (check before video — URLs can have both v= and list=)
    const playlistId = parsePlaylistId(trimmed);
    if (playlistId) return { platform: "youtube", type: "playlist", playlistId };

    // YouTube channel
    const channelHandle = parseChannelHandle(trimmed);
    if (channelHandle) return { platform: "youtube", type: "channel", handle: channelHandle };

    const webUrl = parseWebUrl(trimmed);
    if (webUrl) return { type: "web", url: webUrl };

    const videoId = parseVideoId(trimmed);
    return videoId ? { platform: "youtube", type: "video", videoId } : null;
}
