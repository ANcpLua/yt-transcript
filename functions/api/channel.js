import { dig, digStr, digArr, jsonResponse, innertubeBrowse, CLIENT_CONTEXT } from "../_shared/innertube";
const INNERTUBE_RESOLVE = "https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false";
const VIDEOS_TAB_PARAMS = "EgZ2aWRlb3PyBgQKAjoA";
async function resolveHandle(handle) {
    const cleanHandle = handle.startsWith("@") ? handle : `@${handle}`;
    const res = await fetch(INNERTUBE_RESOLVE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            context: CLIENT_CONTEXT,
            url: `https://www.youtube.com/${cleanHandle}`,
        }),
    });
    if (!res.ok)
        return null;
    const data = await res.json();
    return digStr(data, "endpoint.browseEndpoint.browseId") || null;
}
function extractFromGrid(items) {
    const videos = [];
    for (const item of items) {
        const renderer = dig(item, "gridVideoRenderer") ??
            dig(item, "richItemRenderer.content.videoRenderer");
        if (!renderer)
            continue;
        const videoId = digStr(renderer, "videoId");
        if (!videoId)
            continue;
        const titleRuns = digArr(renderer, "title.runs");
        const title = titleRuns.map((r) => r.text).join("") || "Untitled";
        const overlays = digArr(renderer, "thumbnailOverlays");
        let duration = "";
        for (const overlay of overlays) {
            const text = digStr(overlay, "thumbnailOverlayTimeStatusRenderer.text.simpleText");
            if (text) {
                duration = text;
                break;
            }
        }
        if (!duration) {
            duration = digStr(renderer, "lengthText.simpleText", "0:00");
        }
        videos.push({ videoId, title, duration });
    }
    return videos;
}
export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const handle = url.searchParams.get("handle");
    const channelId = url.searchParams.get("id");
    if (!handle && !channelId) {
        return jsonResponse({ error: "invalid_request", message: "Provide ?handle=@xxx or ?id=UCxxx" }, 400);
    }
    let browseId;
    if (channelId) {
        browseId = channelId;
    }
    else {
        const resolved = await resolveHandle(handle);
        if (!resolved) {
            return jsonResponse({ error: "unavailable", message: "Could not resolve channel handle" }, 404);
        }
        browseId = resolved;
    }
    try {
        const res = await innertubeBrowse({ browseId, params: VIDEOS_TAB_PARAMS });
        if (!res.ok) {
            return jsonResponse({ error: "fetch_failed", message: `YouTube returned ${res.status}` }, 502);
        }
        const data = await res.json();
        const channelTitle = digStr(data, "metadata.channelMetadataRenderer.title", "Channel");
        const tabs = digArr(data, "contents.twoColumnBrowseResultsRenderer.tabs");
        let gridItems = [];
        for (const tab of tabs) {
            if (!dig(tab, "tabRenderer.selected"))
                continue;
            gridItems = digArr(tab, "tabRenderer.content.richGridRenderer.contents");
            if (gridItems.length === 0) {
                gridItems = digArr(tab, "tabRenderer.content.sectionListRenderer.contents.0.itemSectionRenderer.contents.0.gridRenderer.items");
            }
            break;
        }
        const videos = extractFromGrid(gridItems).slice(0, 30);
        return jsonResponse({ channelTitle, videos });
    }
    catch {
        return jsonResponse({ error: "fetch_failed", message: "Failed to fetch channel from YouTube" }, 502);
    }
}
