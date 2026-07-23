import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname, "../..");

async function importBundled(entryPoint) {
  const result = await build({
    entryPoints: [resolve(root, entryPoint)],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0]?.text;
  if (!source) throw new Error(`No output for ${entryPoint}`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const detect = await importBundled("src/lib/timed-text/detect.ts");
const parser = await importBundled("src/lib/timed-text/parse.ts");
const manifests = await importBundled("src/lib/timed-text/manifest.ts");
const audio = await importBundled("src/lib/transcription/audio.ts");
const resourceFetcher = await importBundled("src/background/discovery/fetch-resource.ts");

test("the candidate allowlists include every practical URL marker and MIME type", () => {
  const expectedMarkers = [
    ".vtt", ".srt", ".ttml", ".dfxp", ".itt", ".ass", ".ssa", ".smi",
    ".sami", ".sbv", ".sub", ".mpsub", ".lrc", ".mpl2", ".rt", ".scc",
    ".mcc", ".stl", ".cap", ".tds", ".pac", ".sup", ".idx", ".xml", ".json",
    ".m3u8", ".mpd", ".m4s", ".mp4", "timedtext", "texttrack", "text-track",
    "subtitle", "subtitles", "caption", "captions", "closedcaption",
    "closed-caption", "transcript",
  ];
  const expectedMimes = [
    "text/vtt", "application/ttml+xml", "application/vnd.dece.ttml+xml",
    "video/3gpp-tt", "application/x-subrip", "text/srt", "application/srt",
    "text/x-ass", "text/x-ssa", "application/x-sami", "application/dash+xml",
    "application/vnd.apple.mpegurl", "application/x-mpegurl", "application/mp4",
    "video/mp4", "application/json", "application/xml", "text/xml",
    "image/vnd.dvb.subtitle",
  ];
  assert.deepEqual(detect.TIMED_TEXT_URL_MARKERS, expectedMarkers);
  assert.deepEqual(detect.TIMED_TEXT_MIME_TYPES, expectedMimes);
});

test("candidate classification uses URL and normalized MIME evidence", () => {
  assert.deepEqual(
    detect.classifyTimedTextCandidate("https://cdn.test/assets/captions?id=7", "text/vtt; charset=utf-8"),
    {
      matched: true,
      format: "webvtt",
      inspectBody: true,
      urlMatched: true,
      mimeMatched: true,
    },
  );
  assert.equal(
    detect.classifyTimedTextCandidate("https://cdn.test/segment.m4s", "video/mp4").inspectBody,
    false,
  );
  assert.equal(
    detect.classifyTimedTextCandidate("https://cdn.test/image.jpg", "image/jpeg").matched,
    false,
  );
});

test("WebVTT, SRT, TTML, ASS, SAMI, SBV, LRC, and JSON cues normalize to segments", () => {
  const cases = [
    ["webvtt", "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello <b>world</b>", 1, 2.5, "Hello world"],
    ["srt", "1\n00:00:04,000 --> 00:00:06,250\nSecond cue", 4, 2.25, "Second cue"],
    ["ttml", '<?xml version="1.0"?><tt xmlns:ttp="x" ttp:frameRate="25"><body><div><p begin="00:00:02:12" end="4s">Frame cue</p></div></body></tt>', 2.48, 1.52, "Frame cue"],
    ["ass", "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:03.00,0:00:05.00,Default,,0,0,0,,Styled{\\i1} cue", 3, 2, "Styled cue"],
    ["sami", "<SAMI><BODY><SYNC Start=1000><P>One<br>line<SYNC Start=3000><P>Two</BODY></SAMI>", 1, 2, "One\nline"],
    ["sbv", "0:00:02.000,0:00:04.000\nSBV cue", 2, 2, "SBV cue"],
    ["lrc", "[00:07.50]Timed lyric", 7.5, 0, "Timed lyric"],
    ["json", '{"events":[{"tStartMs":8000,"dDurationMs":1500,"segs":[{"utf8":"JSON cue"}]}]}', 8, 1.5, "JSON cue"],
    ["json", '{"transcriptSegmentRenderer":{"startMs":"9000","endMs":"11000","snippet":{"runs":[{"text":"Nested JSON cue"}]}}}', 9, 2, "Nested JSON cue"],
  ];

  for (const [format, body, start, duration, text] of cases) {
    const parsed = parser.parseTimedText(body, {format});
    assert.ok(parsed.segments.length >= 1, format);
    assert.equal(parsed.segments[0].start, start, format);
    assert.ok(Math.abs(parsed.segments[0].duration - duration) < 0.001, format);
    assert.equal(parsed.segments[0].text, text, format);
  }
});

test("HLS expands subtitle playlists and identifies in-band captions", () => {
  const inspection = manifests.inspectHlsManifest(
    [
      "#EXTM3U",
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs/en.m3u8"',
      '#EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,GROUP-ID="cc",NAME="English",INSTREAM-ID="CC1"',
    ].join("\n"),
    "https://cdn.test/master.m3u8",
  );
  assert.deepEqual(inspection.resources, [{
    url: "https://cdn.test/subs/en.m3u8",
    format: "hls",
    language: "en",
    label: "English",
  }]);
  assert.equal(inspection.hasInBandCaptions, true);
});

test("DASH expands direct text representations and flags segmented timed text", () => {
  const inspection = manifests.inspectDashManifest(
    [
      '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">',
      '<Period><AdaptationSet contentType="text" lang="de" mimeType="application/ttml+xml">',
      '<Representation id="sub"><BaseURL>captions/de.ttml</BaseURL><SegmentTemplate media="sub-$Number$.m4s"/></Representation>',
      "</AdaptationSet></Period></MPD>",
    ].join(""),
    "https://cdn.test/manifest.mpd",
  );
  assert.deepEqual(inspection.resources, [{
    url: "https://cdn.test/captions/de.ttml",
    format: "ttml",
    language: "de",
  }]);
  assert.equal(inspection.hasUnsupportedSegments, true);
});

test("audio fallback drops silence and model refusal prose", () => {
  assert.equal(audio.isSilentPcm(new Float32Array(16_000), 0.002), true);
  assert.equal(audio.isSilentPcm(Float32Array.from([0.1, -0.1]), 0.002), false);
  assert.equal(
    audio.sanitizeTranscription(
      "I'm not able to transcribe audio clips. Is there anything else I can help you with?",
    ),
    "",
  );
  assert.equal(audio.sanitizeTranscription("  Words actually spoken.  "), "Words actually spoken.");
});

test("extension-context caption fetches are anonymous, bounded, and preserve metadata", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({url, credentials: init?.credentials});
    return new Response("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFetched cue", {
      headers: {"content-type": "text/vtt; charset=utf-8"},
    });
  };
  try {
    const result = await resourceFetcher.fetchTimedTextResource({
      url: "https://captions-cdn.test/captions.vtt",
      mimeType: "",
      format: "webvtt",
      source: "track",
      language: "fr",
      label: "French",
      kind: "captions",
    });
    assert.deepEqual(calls, [{
      url: "https://captions-cdn.test/captions.vtt",
      credentials: "omit",
    }]);
    assert.equal(result.mimeType, "text/vtt; charset=utf-8");
    assert.match(result.bodyText, /Fetched cue/);
    assert.equal(result.language, "fr");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
