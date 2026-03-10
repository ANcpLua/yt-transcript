import { CLIENT_CONTEXT, INNERTUBE_BROWSE_URL, dig, digArr, digStr, innertubeBrowse } from "./innertube";

export interface VideoItem {
  videoId: string;
  title: string;
  duration: string;
}

const INNERTUBE_RESOLVE = "https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false";
const VIDEOS_TAB_PARAMS = "EgZ2aWRlb3PyBgQKAjoA";

function titleRuns(renderer: unknown): string {
  return (digArr(renderer, "title.runs") as { text: string }[]).map((r) => r.text).join("") || "Untitled";
}

function extractVideos(contents: unknown[]): VideoItem[] {
  const videos: VideoItem[] = [];
  for (const item of contents) {
    const r = dig(item, "playlistVideoRenderer");
    if (!r) continue;
    const videoId = digStr(r, "videoId");
    if (!videoId) continue;
    videos.push({ videoId, title: titleRuns(r), duration: digStr(r, "lengthText.simpleText", "0:00") });
  }
  return videos;
}

function extractContinuationToken(items: unknown[]): string | undefined {
  for (const item of items) {
    const token = digStr(item, "continuationItemRenderer.continuationEndpoint.continuationCommand.token");
    if (token) return token;
  }
}

function extractFromGrid(items: unknown[]): VideoItem[] {
  const videos: VideoItem[] = [];
  for (const item of items) {
    const r = dig(item, "gridVideoRenderer") ?? dig(item, "richItemRenderer.content.videoRenderer");
    if (!r) continue;
    const videoId = digStr(r, "videoId");
    if (!videoId) continue;
    let duration = "";
    for (const overlay of digArr(r, "thumbnailOverlays")) {
      const text = digStr(overlay, "thumbnailOverlayTimeStatusRenderer.text.simpleText");
      if (text) { duration = text; break; }
    }
    videos.push({ videoId, title: titleRuns(r), duration: duration || digStr(r, "lengthText.simpleText", "0:00") });
  }
  return videos;
}

async function resolveHandle(handle: string): Promise<string | null> {
  const cleanHandle = handle.startsWith("@") ? handle : `@${handle}`;
  try {
    const res = await fetch(INNERTUBE_RESOLVE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: CLIENT_CONTEXT, url: `https://www.youtube.com/${cleanHandle}` }),
    });
    if (!res.ok) return null;
    return digStr(await res.json() as unknown, "endpoint.browseEndpoint.browseId") || null;
  } catch {
    return null;
  }
}

export async function fetchPlaylist(
  playlistId: string,
): Promise<{ playlistTitle: string; videos: VideoItem[] } | { error: string }> {
  let data: unknown;
  try {
    const res = await innertubeBrowse({ browseId: `VL${playlistId}` });
    if (!res.ok) return { error: `Playlist fetch failed: HTTP ${res.status}` };
    data = await res.json();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const base = "contents.twoColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents.0";
  let contents = digArr(data, `${base}.itemSectionRenderer.contents.0.playlistVideoListRenderer.contents`);
  if (contents.length === 0) contents = digArr(data, `${base}.playlistVideoListRenderer.contents`);
  if (contents.length === 0) return { error: "Could not locate playlist videos in response" };

  const videos = extractVideos(contents);
  let continuationToken = extractContinuationToken(contents);
  while (continuationToken && videos.length < 200) {
    try {
      const pageRes = await innertubeBrowse({ continuation: continuationToken });
      if (!pageRes.ok) break;
      const pageContents = digArr(
        await pageRes.json(),
        "onResponseReceivedActions.0.appendContinuationItemsAction.continuationItems",
      );
      if (pageContents.length === 0) break;
      videos.push(...extractVideos(pageContents));
      continuationToken = extractContinuationToken(pageContents);
    } catch { break; }
  }

  return { playlistTitle: digStr(data, "header.playlistHeaderRenderer.title.simpleText", "Playlist"), videos };
}

export async function fetchChannel(
  identifier: string,
): Promise<{ channelTitle: string; videos: VideoItem[] } | { error: string }> {
  const browseId = identifier.startsWith("UC") ? identifier : await resolveHandle(identifier);
  if (!browseId) return { error: `Could not resolve channel identifier: ${identifier}` };

  let data: unknown;
  try {
    const res = await fetch(INNERTUBE_BROWSE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: CLIENT_CONTEXT, browseId, params: VIDEOS_TAB_PARAMS }),
    });
    if (!res.ok) return { error: `Channel fetch failed: HTTP ${res.status}` };
    data = await res.json();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const tabBase = "contents.twoColumnBrowseResultsRenderer.tabs.1.tabRenderer.content";
  let gridItems = digArr(data, `${tabBase}.richGridRenderer.contents`);
  if (gridItems.length === 0)
    gridItems = digArr(data, `${tabBase}.sectionListRenderer.contents.0.itemSectionRenderer.contents.0.gridRenderer.items`);

  return { channelTitle: digStr(data, "header.c4TabbedHeaderRenderer.title", "Channel"), videos: extractFromGrid(gridItems).slice(0, 30) };
}
