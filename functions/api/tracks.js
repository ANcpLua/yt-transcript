const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
function json(data, status) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
}
export const onRequestGet = async ({ request }) => {
    const url = new URL(request.url);
    const videoId = url.searchParams.get("videoId") ?? "";
    if (!VIDEO_ID_RE.test(videoId)) {
        return json({ error: "invalid_id", message: "Invalid video ID." }, 400);
    }
    try {
        const res = await fetch(INNERTUBE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "User-Agent": UA },
            body: JSON.stringify({
                context: { client: { clientName: "WEB", clientVersion: "2.20240101.00.00" } },
                videoId,
            }),
        });
        if (res.status === 429) {
            return json({ error: "rate_limited", message: "YouTube is temporarily limiting requests." }, 429);
        }
        if (!res.ok) {
            return json({ error: "fetch_failed", message: `YouTube returned ${String(res.status)}.` }, 502);
        }
        const data = (await res.json());
        const details = data.videoDetails;
        const captions = data.captions;
        const tracks = captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
        return json({
            videoId,
            title: details?.title ?? "Untitled",
            tracks: tracks.map((t) => ({
                languageCode: t.languageCode,
                name: t.name?.simpleText ?? t.languageCode,
                ...(t.kind ? { kind: t.kind } : {}),
            })),
        }, 200);
    }
    catch {
        return json({ error: "fetch_failed", message: "Failed to connect to YouTube." }, 502);
    }
};
