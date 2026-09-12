import assert from "node:assert/strict";
import {test} from "vitest";
import {build} from "esbuild";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

async function importBundled(entryPoint) {
  const result = await build({
    entryPoints: [resolve(root, entryPoint)],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const {browserLanguages, compareTracks, languageTier, primaryLanguage} = await importBundled("src/lib/timed-text/track-order.ts");

const track = (language, segments, extra = {}) => ({
  language,
  label: extra.label ?? language,
  kind: extra.kind ?? "subtitles",
  source: extra.source ?? "network-resource",
  segments: Array.from({length: segments}, () => ({})),
});

function defaultTrack(tracks, context) {
  return [...tracks].sort((left, right) => compareTracks(left, right, context))[0];
}

test("primaryLanguage and languageTier: page, browser, English, other", () => {
  assert.equal(primaryLanguage("pt-BR"), "pt");
  assert.equal(primaryLanguage("EN_us"), "en");
  const context = {pageLanguage: "de", browserLanguages: ["fr-FR", "it"]};
  assert.equal(languageTier("de-AT", context), 3);
  assert.equal(languageTier("fr", context), 2);
  assert.equal(languageTier("en-GB", context), 1);
  assert.equal(languageTier("pt-BR", context), 0);
  assert.equal(languageTier("und", {pageLanguage: "und", browserLanguages: ["und"]}), 0, "und never matches");
});

test("a talk page in English opens in English even when the Portuguese file is longer", () => {
  const tracks = [
    track("pt-BR", 900, {label: "Portuguese, Brazilian"}),
    track("en", 800, {label: "English"}),
    track("de", 850, {label: "German"}),
  ];
  const context = {pageLanguage: "en", browserLanguages: ["de-DE", "en-US"]};
  assert.equal(defaultTrack(tracks, context).language, "en");
});

test("without a page language the browser language wins, then English, then the rank", () => {
  const tracks = [track("pt-BR", 900), track("en", 700), track("de", 850)];
  assert.equal(defaultTrack(tracks, {pageLanguage: "und", browserLanguages: ["de-DE"]}).language, "de");
  assert.equal(defaultTrack(tracks, {pageLanguage: "und", browserLanguages: ["fr"]}).language, "en");
  const noEnglish = [track("pt-BR", 900), track("es", 950)];
  assert.equal(defaultTrack(noEnglish, {pageLanguage: "und", browserLanguages: ["fr"]}).language, "es", "rank decides");
});

test("inside one language a page track outranks a fetched one and the order is deterministic", () => {
  const context = {pageLanguage: "en", browserLanguages: []};
  const fetched = track("en", 500, {label: "English", source: "network-resource"});
  const runtime = track("en", 500, {label: "English", source: "page-track"});
  assert.equal(defaultTrack([fetched, runtime], context).source, "page-track");
  assert.equal(defaultTrack([runtime, fetched], context).source, "page-track");
  const a = track("en", 10, {label: "A"});
  const b = track("en", 10, {label: "B"});
  assert.equal(defaultTrack([b, a], context).label, "A");
});

test("browserLanguages reads navigator.languages, falls back to language, tolerates no navigator", () => {
  assert.deepEqual(browserLanguages({languages: ["de-DE", "en"]}), ["de-DE", "en"]);
  assert.deepEqual(browserLanguages({languages: [], language: "fr"}), ["fr"]);
  assert.deepEqual(browserLanguages(null), []);
});
