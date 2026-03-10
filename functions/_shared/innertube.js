/** Shared Innertube helpers for Cloudflare Pages Functions. */
export const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false";
export const CLIENT_CONTEXT = {
    client: { clientName: "WEB", clientVersion: "2.20240101.00.00" },
};
/** Safely walk a dot-separated path through nested unknown JSON. */
export function dig(obj, path) {
    let current = obj;
    for (const key of path.split(".")) {
        if (current === null || current === undefined || typeof current !== "object")
            return undefined;
        current = current[key];
    }
    return current;
}
export function digStr(obj, path, fallback = "") {
    const val = dig(obj, path);
    return typeof val === "string" ? val : fallback;
}
export function digArr(obj, path) {
    const val = dig(obj, path);
    return Array.isArray(val) ? val : [];
}
export function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}
export function innertubeBrowse(body) {
    return fetch(INNERTUBE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: CLIENT_CONTEXT, ...body }),
    });
}
