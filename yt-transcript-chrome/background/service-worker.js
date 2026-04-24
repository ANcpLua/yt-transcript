var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/ai/providers.ts
var providers_exports = {};
__export(providers_exports, {
  getProvider: () => getProvider
});
function handleErrorStatus(status, provider) {
  switch (true) {
    case (status === 401 || status === 403):
      throw new AiError(
        `Invalid API key for ${provider}. Please check your key in Settings.`,
        status,
        provider
      );
    case status === 429:
      throw new AiError(
        `Rate limit exceeded for ${provider}. Please wait a moment and try again.`,
        status,
        provider
      );
    case status >= 500:
      throw new AiError(
        `${provider} server error (${status}). Please try again later.`,
        status,
        provider
      );
    default:
      throw new AiError(
        `${provider} request failed with status ${status}.`,
        status,
        provider
      );
  }
}
function createOpenAiProvider(apiKey) {
  const BASE_URL = "https://api.openai.com/v1";
  const MODEL = "gpt-4o-mini";
  async function request(body) {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      handleErrorStatus(response.status, "OpenAI");
    }
    return response;
  }
  return {
    name: "openai",
    async sendMessage({ systemPrompt, userMessage, maxTokens = 4096 }) {
      const response = await request({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        max_tokens: maxTokens
      });
      const data = await response.json();
      const content = data.choices[0]?.message.content;
      if (content === null || content === void 0) {
        throw new AiError("OpenAI returned empty response.", 0, "OpenAI");
      }
      return content;
    },
    async validateKey() {
      try {
        const response = await fetch(`${BASE_URL}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` }
        });
        return response.ok;
      } catch {
        return false;
      }
    }
  };
}
function createAnthropicProvider(apiKey) {
  const BASE_URL = "https://api.anthropic.com/v1";
  const MODEL = "claude-haiku-4-5-20251001";
  async function request(body) {
    const response = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      handleErrorStatus(response.status, "Anthropic");
    }
    return response;
  }
  return {
    name: "anthropic",
    async sendMessage({ systemPrompt, userMessage, maxTokens = 4096 }) {
      const response = await request({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }]
      });
      const data = await response.json();
      const textBlock = data.content.find((b) => b.type === "text");
      if (!textBlock) {
        throw new AiError(
          "Anthropic returned empty response.",
          0,
          "Anthropic"
        );
      }
      return textBlock.text;
    },
    async validateKey() {
      try {
        const response = await request({
          model: MODEL,
          max_tokens: 1,
          messages: [{ role: "user", content: "Hi" }]
        });
        return response.ok || response.status === 200;
      } catch (err) {
        if (err instanceof AiError && (err.status === 401 || err.status === 403)) {
          return false;
        }
        if (err instanceof AiError && err.status === 429) {
          return true;
        }
        return false;
      }
    }
  };
}
function createGoogleProvider(apiKey) {
  const MODEL = "gemini-2.0-flash";
  const BASE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`;
  async function request(body) {
    const response = await fetch(
      `${BASE_URL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }
    );
    if (!response.ok) {
      handleErrorStatus(response.status, "Google Gemini");
    }
    return response;
  }
  return {
    name: "google",
    async sendMessage({ systemPrompt, userMessage, maxTokens = 4096 }) {
      const response = await request({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userMessage }]
          }
        ],
        generationConfig: {
          maxOutputTokens: maxTokens
        }
      });
      const data = await response.json();
      const text = data.candidates[0]?.content.parts[0]?.text;
      if (text === void 0) {
        throw new AiError(
          "Google Gemini returned empty response.",
          0,
          "Google Gemini"
        );
      }
      return text;
    },
    async validateKey() {
      try {
        const response = await fetch(
          `${BASE_URL}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                { role: "user", parts: [{ text: "Hi" }] }
              ],
              generationConfig: { maxOutputTokens: 1 }
            })
          }
        );
        return response.ok;
      } catch {
        return false;
      }
    }
  };
}
function getProvider(name, apiKey) {
  switch (name) {
    case "openai":
      return createOpenAiProvider(apiKey);
    case "anthropic":
      return createAnthropicProvider(apiKey);
    case "google":
      return createGoogleProvider(apiKey);
    default:
      throw new Error(`Unknown AI provider: ${name}`);
  }
}
var AiError;
var init_providers = __esm({
  "src/lib/ai/providers.ts"() {
    "use strict";
    AiError = class extends Error {
      constructor(message, status, provider) {
        super(message);
        this.status = status;
        this.provider = provider;
        this.name = "AiError";
      }
    };
  }
});

// src/lib/parseChapters.ts
var TIMESTAMP_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+)/;
function parseChapters(description) {
  if (!description) return [];
  const chapters = [];
  const lines = description.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const match = TIMESTAMP_RE.exec(trimmed);
    if (!match) continue;
    const hours = match[1] ? parseInt(match[1], 10) : 0;
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const title = match[4].trim();
    if (title.length === 0) continue;
    chapters.push({
      title,
      start: hours * 3600 + minutes * 60 + seconds
    });
  }
  if (chapters.length < 3) return [];
  if (chapters[0]?.start !== 0) return [];
  return chapters;
}

// src/background/innertube.ts
var INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
var INNERTUBE_BROWSE_URL = "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false";
var WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var PLAYER_CLIENTS = [
  {
    userAgent: WEB_UA,
    headers: { "Content-Type": "application/json", "User-Agent": WEB_UA },
    context: {
      client: {
        clientName: "WEB_EMBEDDED_PLAYER",
        clientVersion: "1.20260330.00.00"
      },
      thirdParty: { embedUrl: "https://www.youtube.com" }
    }
  },
  {
    userAgent: WEB_UA,
    headers: { "Content-Type": "application/json", "User-Agent": WEB_UA },
    context: { client: { clientName: "WEB", clientVersion: "2.20260330.00.00" } }
  }
];
var CLIENT_CONTEXT = { client: { clientName: "WEB", clientVersion: "2.20260330.00.00" } };
function dig(obj, path) {
  let cur = obj;
  for (const key of path.split(".")) {
    if (cur === null || cur === void 0 || typeof cur !== "object") return void 0;
    cur = cur[key];
  }
  return cur;
}
function digStr(obj, path, fallback = "") {
  const v = dig(obj, path);
  return typeof v === "string" ? v : fallback;
}
function digArr(obj, path) {
  const v = dig(obj, path);
  return Array.isArray(v) ? v : [];
}
function innertubeBrowse(body) {
  return fetch(INNERTUBE_BROWSE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: CLIENT_CONTEXT, ...body })
  });
}
function extractPlayerResult(raw, userAgent) {
  const status = digStr(raw, "playabilityStatus.status");
  if (status === "ERROR") return { error: "invalid_id", message: "Video not found." };
  if (status === "LOGIN_REQUIRED")
    return { error: "unavailable", message: "This video requires login." };
  if (status === "UNPLAYABLE") {
    const reason = digStr(raw, "playabilityStatus.reason");
    return { error: "fetch_failed", message: reason || "Video is unplayable with this client." };
  }
  const captionTracks = digArr(
    raw,
    "captions.playerCaptionsTracklistRenderer.captionTracks"
  ).filter((t) => typeof t === "object" && t !== null).filter((t) => typeof t["baseUrl"] === "string").map((t) => ({
    baseUrl: t["baseUrl"],
    languageCode: typeof t["languageCode"] === "string" ? t["languageCode"] : "",
    kind: typeof t["kind"] === "string" ? t["kind"] : void 0,
    name: t["name"]
  }));
  return {
    title: digStr(raw, "videoDetails.title", "Untitled"),
    captionTracks,
    shortDescription: digStr(raw, "videoDetails.shortDescription"),
    userAgent
  };
}
async function tryInnertubeClients(videoId) {
  let lastErr = "fetch_failed";
  let gotEmptyTracks = false;
  for (const client of PLAYER_CLIENTS) {
    let raw;
    try {
      const res = await fetch(INNERTUBE_PLAYER_URL, {
        method: "POST",
        headers: client.headers,
        body: JSON.stringify({ context: client.context, videoId })
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      raw = await res.json();
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }
    const result = extractPlayerResult(raw, client.userAgent);
    if ("error" in result) {
      if (result.error === "invalid_id") return result;
      lastErr = result.message;
      continue;
    }
    if (result.captionTracks.length > 0) return result;
    gotEmptyTracks = true;
  }
  if (gotEmptyTracks) return { error: "no_captions", message: "This video has no captions available." };
  return { error: "fetch_failed", message: lastErr };
}
async function scrapeWatchPage(videoId) {
  let html;
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": WEB_UA, "Accept-Language": "en-US,en;q=0.9" },
      credentials: "include"
    });
    if (!res.ok) return { error: "fetch_failed", message: `Watch page HTTP ${res.status}` };
    html = await res.text();
  } catch (e) {
    return { error: "fetch_failed", message: e instanceof Error ? e.message : String(e) };
  }
  const match = /var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});\s*(?:var|const|let|<\/script>)/s.exec(html);
  if (!match) return { error: "fetch_failed", message: "Could not extract player response from watch page" };
  try {
    return extractPlayerResult(JSON.parse(match[1]), WEB_UA);
  } catch {
    return { error: "fetch_failed", message: "Failed to parse embedded player response JSON" };
  }
}
async function resolvePlayer(videoId, pagePlayerResponse) {
  if (pagePlayerResponse) {
    const fromPage = extractPlayerResult(pagePlayerResponse, WEB_UA);
    if (!("error" in fromPage) && fromPage.captionTracks.length > 0) return fromPage;
  }
  const fromApi = await tryInnertubeClients(videoId);
  if (!("error" in fromApi)) return fromApi;
  if (fromApi.error === "invalid_id") return fromApi;
  return scrapeWatchPage(videoId);
}
function parseSegments(events) {
  const segments = [];
  for (const ev of events) {
    if (typeof ev !== "object" || ev === null) continue;
    const event = ev;
    const segs = event.segs;
    if (!Array.isArray(segs) || segs.length === 0) continue;
    const text = segs.map((s) => typeof s.utf8 === "string" ? s.utf8 : "").join("").trim();
    if (text.length === 0) continue;
    segments.push({ start: (event.tStartMs ?? 0) / 1e3, duration: (event.dDurationMs ?? 0) / 1e3, text });
  }
  return segments;
}
function getTrackName(track) {
  const name = track.name;
  if (!name) return track.languageCode;
  if (typeof name.simpleText === "string" && name.simpleText.length > 0) return name.simpleText;
  if (Array.isArray(name.runs)) {
    const combined = name.runs.map((r) => typeof r.text === "string" ? r.text : "").join("").trim();
    if (combined.length > 0) return combined;
  }
  return track.languageCode;
}
function mapTracks(captionTracks) {
  return captionTracks.map((t) => ({ languageCode: t.languageCode, name: getTrackName(t), kind: t.kind }));
}
async function fetchTranscript(videoId, lang, translateTo, pagePlayerResponse) {
  const player = await resolvePlayer(videoId, pagePlayerResponse);
  if ("error" in player) return player;
  const { title, captionTracks, shortDescription } = player;
  if (captionTracks.length === 0)
    return { error: "no_captions", message: "This video has no captions available." };
  const track = lang ? captionTracks.find((t) => t.languageCode === lang) ?? captionTracks[0] : captionTracks[0];
  const language = track.languageCode;
  const textUrl = track.baseUrl + "&fmt=json3" + (translateTo && translateTo !== language ? `&tlang=${translateTo}` : "");
  let events;
  try {
    const res = await fetch(textUrl, { headers: { "User-Agent": player.userAgent } });
    if (!res.ok) return { error: "fetch_failed", message: `Transcript fetch HTTP ${res.status}` };
    events = digArr(await res.json(), "events");
  } catch (e) {
    return { error: "fetch_failed", message: e instanceof Error ? e.message : String(e) };
  }
  const segments = parseSegments(events);
  if (segments.length === 0) return { error: "no_captions", message: "Transcript is empty." };
  const chapters = parseChapters(shortDescription);
  const response = {
    videoId,
    title,
    language: translateTo ?? language,
    isAutoGenerated: track.kind === "asr",
    tracks: mapTracks(captionTracks),
    segments,
    ...chapters.length > 0 && { chapters },
    ...translateTo && translateTo !== language && { translatedFrom: language, translatedTo: translateTo }
  };
  return response;
}
async function fetchTracks(videoId, pagePlayerResponse) {
  const player = await resolvePlayer(videoId, pagePlayerResponse);
  if ("error" in player) return player;
  const { title, captionTracks } = player;
  if (captionTracks.length === 0)
    return { error: "no_captions", message: "This video has no captions available." };
  return { tracks: mapTracks(captionTracks), title };
}

// src/background/innertube-browse.ts
var INNERTUBE_RESOLVE = "https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false";
var VIDEOS_TAB_PARAMS = "EgZ2aWRlb3PyBgQKAjoA";
function titleRuns(renderer) {
  return digArr(renderer, "title.runs").map((r) => r.text).join("") || "Untitled";
}
function extractVideos(contents) {
  const videos = [];
  for (const item of contents) {
    const r = dig(item, "playlistVideoRenderer");
    if (!r) continue;
    const videoId = digStr(r, "videoId");
    if (!videoId) continue;
    videos.push({ videoId, title: titleRuns(r), duration: digStr(r, "lengthText.simpleText", "0:00") });
  }
  return videos;
}
function extractContinuationToken(items) {
  for (const item of items) {
    const token = digStr(item, "continuationItemRenderer.continuationEndpoint.continuationCommand.token");
    if (token) return token;
  }
}
function extractFromGrid(items) {
  const videos = [];
  for (const item of items) {
    const r = dig(item, "gridVideoRenderer") ?? dig(item, "richItemRenderer.content.videoRenderer");
    if (!r) continue;
    const videoId = digStr(r, "videoId");
    if (!videoId) continue;
    let duration = "";
    for (const overlay of digArr(r, "thumbnailOverlays")) {
      const text = digStr(overlay, "thumbnailOverlayTimeStatusRenderer.text.simpleText");
      if (text) {
        duration = text;
        break;
      }
    }
    videos.push({ videoId, title: titleRuns(r), duration: duration || digStr(r, "lengthText.simpleText", "0:00") });
  }
  return videos;
}
async function resolveHandle(handle) {
  const cleanHandle = handle.startsWith("@") ? handle : `@${handle}`;
  try {
    const res = await fetch(INNERTUBE_RESOLVE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: CLIENT_CONTEXT, url: `https://www.youtube.com/${cleanHandle}` })
    });
    if (!res.ok) return null;
    return digStr(await res.json(), "endpoint.browseEndpoint.browseId") || null;
  } catch {
    return null;
  }
}
async function fetchPlaylist(playlistId) {
  let data;
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
        "onResponseReceivedActions.0.appendContinuationItemsAction.continuationItems"
      );
      if (pageContents.length === 0) break;
      videos.push(...extractVideos(pageContents));
      continuationToken = extractContinuationToken(pageContents);
    } catch {
      break;
    }
  }
  return { playlistTitle: digStr(data, "header.playlistHeaderRenderer.title.simpleText", "Playlist"), videos };
}
async function fetchChannel(identifier) {
  const browseId = identifier.startsWith("UC") ? identifier : await resolveHandle(identifier);
  if (!browseId) return { error: `Could not resolve channel identifier: ${identifier}` };
  let data;
  try {
    const res = await fetch(INNERTUBE_BROWSE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: CLIENT_CONTEXT, browseId, params: VIDEOS_TAB_PARAMS })
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

// src/background/service-worker.ts
async function requestPagePlayerData(videoId) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes("youtube.com")) return null;
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "request-player-data",
      videoId
    });
    return response?.playerResponse ?? null;
  } catch {
    return null;
  }
}
chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    switch (message.type) {
      case "video-detected":
        if (sender.tab?.id) {
          chrome.action.setBadgeText({ text: "1", tabId: sender.tab.id });
          chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId: sender.tab.id });
        }
        chrome.runtime.sendMessage({ type: "video-info", videoId: message.videoId }).catch(() => {
        });
        return false;
      case "player-time":
        chrome.runtime.sendMessage(message).catch(() => {
        });
        return false;
      case "fetch-transcript":
        requestPagePlayerData(message.videoId).then(
          (pageData) => fetchTranscript(message.videoId, message.lang, message.translateTo, pageData ?? void 0)
        ).then((result) => {
          if ("error" in result) {
            sendResponse({ type: "transcript-error", error: result });
          } else {
            sendResponse({ type: "transcript-result", data: result });
          }
        });
        return true;
      case "fetch-tracks":
        requestPagePlayerData(message.videoId).then(
          (pageData) => fetchTracks(message.videoId, pageData ?? void 0)
        ).then((result) => {
          if ("error" in result) {
            sendResponse({ type: "tracks-error", error: result });
          } else {
            sendResponse({ type: "tracks-result", ...result });
          }
        });
        return true;
      case "fetch-playlist":
        fetchPlaylist(message.playlistId).then((result) => sendResponse(result));
        return true;
      case "fetch-channel":
        fetchChannel(message.identifier).then((result) => sendResponse(result));
        return true;
      case "ai-request":
        handleAiRequest(message).then((content) => sendResponse({ type: "ai-result", content })).catch((err) => sendResponse({ type: "ai-error", error: String(err) }));
        return true;
    }
  }
);
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    const url = new URL(details.url);
    const videoId = url.searchParams.get("v");
    if (videoId) {
      chrome.action.setBadgeText({ text: "1", tabId: details.tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId: details.tabId });
      chrome.runtime.sendMessage({ type: "video-info", videoId }).catch(() => {
      });
    }
  },
  { url: [{ hostSuffix: "youtube.com" }] }
);
async function handleAiRequest(message) {
  if (!message.apiKey) throw new Error("No API key configured");
  const { getProvider: getProvider2 } = await Promise.resolve().then(() => (init_providers(), providers_exports));
  const provider = getProvider2(message.provider, message.apiKey);
  return provider.sendMessage({
    systemPrompt: message.systemPrompt,
    userMessage: message.userMessage
  });
}
