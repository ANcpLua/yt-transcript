import {dig, digArr, digStr, innertubeBrowse, jsonResponse} from "../_shared/innertube";

function extractVideos(contents) {
    const videos = [];
    for (const item of contents) {
        const renderer = dig(item, "playlistVideoRenderer");
        if (!renderer)
            continue;
        const videoId = digStr(renderer, "videoId");
        if (!videoId)
            continue;
        const titleRuns = digArr(renderer, "title.runs");
        const title = titleRuns.map((r) => r.text).join("") || "Untitled";
        const duration = digStr(renderer, "lengthText.simpleText", "0:00");
        videos.push({videoId, title, duration});
    }
    return videos;
}

function extractContinuationToken(items) {
    for (const item of items) {
        const token = digStr(item, "continuationItemRenderer.continuationEndpoint.continuationCommand.token");
        if (token)
            return token;
    }
    return undefined;
}

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const id = url.searchParams.get("id");
    if (!id) {
        return jsonResponse({error: "invalid_request", message: "Missing ?id= parameter"}, 400);
    }
    const browseId = id.startsWith("VL") ? id : `VL${id}`;
    try {
        const firstRes = await innertubeBrowse({browseId});
        if (!firstRes.ok) {
            return jsonResponse({error: "fetch_failed", message: `YouTube returned ${firstRes.status}`}, 502);
        }
        const data = await firstRes.json();
        const playlistTitle = digStr(data, "header.playlistHeaderRenderer.title.simpleText", "Playlist");
        const playlistRenderer = dig(data, "contents.twoColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents.0.itemSectionRenderer.contents.0.playlistVideoListRenderer");
        if (!playlistRenderer) {
            return jsonResponse({error: "unavailable", message: "Could not parse playlist"}, 502);
        }
        const contents = digArr(playlistRenderer, "contents");
        let allVideos = extractVideos(contents);
        let continuationToken = digStr(playlistRenderer, "continuations.0.nextContinuationData.continuation") ||
            extractContinuationToken(contents);
        while (continuationToken && allVideos.length < 200) {
            const contRes = await innertubeBrowse({continuation: continuationToken});
            if (!contRes.ok)
                break;
            const contData = await contRes.json();
            const contItems = digArr(contData, "onResponseReceivedActions.0.appendContinuationItemsAction.continuationItems");
            allVideos = allVideos.concat(extractVideos(contItems));
            continuationToken = extractContinuationToken(contItems);
        }
        return jsonResponse({playlistTitle, videos: allVideos});
    } catch {
        return jsonResponse({error: "fetch_failed", message: "Failed to fetch playlist from YouTube"}, 502);
    }
}
