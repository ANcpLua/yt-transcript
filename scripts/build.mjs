import { execFileSync } from "child_process";
import { cpSync, mkdirSync, existsSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const chromeDist = resolve(root, "packages/extension/dist-chrome");

function bin(name) {
  return resolve(root, "node_modules/.bin", process.platform === "win32" ? `${name}.cmd` : name);
}

function runBin(name, args) {
  console.log(`> ${name} ${args.join(" ")}`);
  execFileSync(bin(name), args, { cwd: root, stdio: "inherit" });
}

// Clean
if (existsSync(dist)) rmSync(dist, { recursive: true });
if (existsSync(chromeDist)) rmSync(chromeDist, { recursive: true });
mkdirSync(dist, { recursive: true });

// 1. Side panel (Vite React build)
runBin("vite", ["build"]);

// 2. Background service worker (esbuild, ESM)
mkdirSync(resolve(dist, "background"), { recursive: true });
runBin("esbuild", [
  "src/background/service-worker.ts",
  "--bundle",
  "--format=esm",
  "--target=es2022",
  "--outfile=dist/background/service-worker.js",
]);

// 3. Content script — YouTube (esbuild, IIFE)
mkdirSync(resolve(dist, "content"), { recursive: true });
runBin("esbuild", [
  "src/content/content.ts",
  "--bundle",
  "--format=iife",
  "--target=es2022",
  "--outfile=dist/content/content.js",
]);

// 4. Content script — Vimeo (esbuild, IIFE)
runBin("esbuild", [
  "src/content/vimeo-content.ts",
  "--bundle",
  "--format=iife",
  "--target=es2022",
  "--outfile=dist/content/vimeo-content.js",
]);

// 4a. YouTube MAIN-world fetch interceptor (esbuild, IIFE)
runBin("esbuild", [
  "src/content/yt-interceptor.ts",
  "--bundle",
  "--format=iife",
  "--target=es2022",
  "--outfile=dist/content/yt-interceptor.js",
]);

// 4b. YouTube ISOLATED-world bridge (esbuild, IIFE)
runBin("esbuild", [
  "src/content/yt-bridge.ts",
  "--bundle",
  "--format=iife",
  "--target=es2022",
  "--outfile=dist/content/yt-bridge.js",
]);

// 5. Offscreen document (esbuild, ESM — runs in offscreen page context)
mkdirSync(resolve(dist, "offscreen"), { recursive: true });
runBin("esbuild", [
  "src/background/transcribe/offscreen.ts",
  "--bundle",
  "--format=esm",
  "--target=es2022",
  "--outfile=dist/offscreen/offscreen.js",
]);
// 5a. AudioWorklet processor (runs on the audio thread, separate bundle)
runBin("esbuild", [
  "src/background/transcribe/worklet-processor.ts",
  "--bundle",
  "--format=iife",
  "--target=es2022",
  "--outfile=dist/offscreen/worklet-processor.js",
]);
cpSync(
  resolve(root, "src/background/transcribe/offscreen.html"),
  resolve(dist, "offscreen/offscreen.html")
);

// 5b. Vendor ORT runtime so the offscreen Whisper pipeline doesn't load
// ort-wasm-simd-threaded.jsep.{mjs,wasm} from jsdelivr at runtime —
// MV3's default CSP forbids that. Same JSEP build serves both WebGPU
// and the WASM fallback.
const ortVendor = resolve(dist, "vendor/transformers");
mkdirSync(ortVendor, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
  cpSync(
    resolve(root, "node_modules/@huggingface/transformers/dist", f),
    resolve(ortVendor, f),
  );
}

// 6. Copy static assets
cpSync(resolve(root, "manifest.json"), resolve(dist, "manifest.json"));
cpSync(resolve(root, "public/icons"), resolve(dist, "icons"), { recursive: true });

if (existsSync(resolve(root, "public/fonts"))) {
  cpSync(resolve(root, "public/fonts"), resolve(dist, "fonts"), { recursive: true });
}

mkdirSync(dirname(chromeDist), { recursive: true });
cpSync(dist, chromeDist, { recursive: true });

console.log("\nExtension built to dist/ and packages/extension/dist-chrome/");
