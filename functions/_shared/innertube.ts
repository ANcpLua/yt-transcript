/** Shared Innertube helpers for Cloudflare Pages Functions. */

export const INNERTUBE_PLAYER_URL =
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

export const INNERTUBE_BROWSE_URL =
    "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false";

export const WEB_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const ANDROID_USER_AGENT =
    "com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip";

/** Client configs to try in order when fetching player data. */
export interface PlayerClient {
    clientName: string;
    clientVersion: string;
    userAgent: string;
    headers: Record<string, string>;
    context: Record<string, unknown>;
}

export const PLAYER_CLIENTS: readonly PlayerClient[] = [
    {
        clientName: "ANDROID",
        clientVersion: "21.03.36",
        userAgent: ANDROID_USER_AGENT,
        headers: {
            "Content-Type": "application/json",
            "User-Agent": ANDROID_USER_AGENT,
            "X-Goog-Api-Format-Version": "2",
        },
        context: {
            client: {
                clientName: "ANDROID",
                clientVersion: "21.03.36",
                androidSdkVersion: 36,
                userAgent: ANDROID_USER_AGENT,
                hl: "en",
                gl: "US",
            },
        },
    },
    {
        clientName: "WEB",
        clientVersion: "2.20260301.00.00",
        userAgent: WEB_USER_AGENT,
        headers: {
            "Content-Type": "application/json",
            "User-Agent": WEB_USER_AGENT,
        },
        context: {
            client: {
                clientName: "WEB",
                clientVersion: "2.20260301.00.00",
            },
        },
    },
];

export const CLIENT_CONTEXT = {
    client: {
        clientName: "WEB",
        clientVersion: "2.20260301.00.00",
    },
};

/** Safely walk a dot-separated path through nested unknown JSON. */
export function dig(obj: unknown, path: string): unknown {
    let current = obj;
    for (const key of path.split(".")) {
        if (current === null || current === undefined || typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}

export function digStr(obj: unknown, path: string, fallback: string = ""): string {
    const val = dig(obj, path);
    return typeof val === "string" ? val : fallback;
}

export function digArr(obj: unknown, path: string): unknown[] {
    const val = dig(obj, path);
    return Array.isArray(val) ? val : [];
}

export function jsonResponse(body: unknown, status: number = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {"Content-Type": "application/json"},
    });
}

export function innertubeBrowse(body: Record<string, unknown>): Promise<Response> {
    return fetch(INNERTUBE_BROWSE_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({context: CLIENT_CONTEXT, ...body}),
    });
}
