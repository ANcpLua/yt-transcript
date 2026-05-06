// Mirror dist/ into dist-firefox/ with a manifest patched for
// Firefox: chrome.sidePanel doesn't exist in Firefox, so we expose
// the same sidepanel/index.html via sidebar_action; gecko id is
// required for unsigned dev installs.

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "dist");
const dst = resolve(root, "dist-firefox");

if (!existsSync(src)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
if (existsSync(dst)) rmSync(dst, { recursive: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });

const manifest = JSON.parse(readFileSync(resolve(dst, "manifest.json"), "utf8"));

// Firefox-specific
manifest.browser_specific_settings = {
  gecko: {
    id: "yt-transcript@ancplua.dev",
    strict_min_version: "128.0",
  },
};

// Permissions Firefox doesn't recognize — drop them.
//   sidePanel    — Chrome/Edge only
//   tabCapture   — Chrome/Edge only (Whisper local capture won't work)
//   offscreen    — Chrome/Edge only (no offscreen documents in Firefox)
manifest.permissions = (manifest.permissions || []).filter(
  (p) => !["sidePanel", "tabCapture", "offscreen"].includes(p),
);

// Firefox is strict about host patterns — port wildcards aren't allowed.
// Drop localhost (Ollama) since "http://localhost:*/*" fails parsing,
// and rewrite without ports if any pattern still uses them.
manifest.optional_host_permissions = (manifest.optional_host_permissions || []).filter(
  (p) => !p.includes("localhost") && !p.includes("127.0.0.1"),
);

// chrome.sidePanel doesn't exist in Firefox — expose the same panel
// HTML via sidebar_action so the user can open it from the toolbar.
delete manifest.side_panel;
manifest.sidebar_action = {
  default_title: "YouTube & Vimeo Transcript",
  default_panel: "sidepanel/index.html",
  default_icon: manifest.icons,
};

// Firefox MV3 supports background.service_worker since 121, but
// background.scripts is the more portable form. Keep service_worker
// for parity and add scripts for older Firefoxes that ignore it.
manifest.background = {
  service_worker: "background/service-worker.js",
  scripts: ["background/service-worker.js"],
  type: "module",
};

writeFileSync(resolve(dst, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log("✅ Firefox build at", dst);
