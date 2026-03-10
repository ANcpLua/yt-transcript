import { execSync } from "child_process";
import { cpSync, mkdirSync, existsSync, rmSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

// Clean
if (existsSync(dist)) rmSync(dist, { recursive: true });
mkdirSync(dist, { recursive: true });

// 1. Side panel (Vite React build)
run("npx vite build");

// 2. Background service worker (esbuild, ESM)
mkdirSync(resolve(dist, "background"), { recursive: true });
run(
  `npx esbuild src/background/service-worker.ts ` +
  `--bundle --format=esm --target=es2022 ` +
  `--outfile=dist/background/service-worker.js`
);

// 3. Content script (esbuild, IIFE)
mkdirSync(resolve(dist, "content"), { recursive: true });
run(
  `npx esbuild src/content/content.ts ` +
  `--bundle --format=iife --target=es2022 ` +
  `--outfile=dist/content/content.js`
);

// 4. Copy static assets
cpSync(resolve(root, "manifest.json"), resolve(dist, "manifest.json"));
cpSync(resolve(root, "public/icons"), resolve(dist, "icons"), { recursive: true });

if (existsSync(resolve(root, "public/fonts"))) {
  cpSync(resolve(root, "public/fonts"), resolve(dist, "fonts"), { recursive: true });
}

console.log("\n✅ Extension built to dist/");
