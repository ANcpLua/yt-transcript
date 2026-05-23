/**
 * Package the extension for Chrome, Edge, and Firefox stores.
 * Run after `npm run build` — expects dist/ to exist.
 *
 * Outputs:
 *   yt-transcript-chrome.zip  — Chrome Web Store + Edge Add-ons (same MV3 manifest)
 *   yt-transcript-firefox.zip — Firefox Add-ons (sidebar_action, gecko settings)
 */
import {execSync} from "child_process";
import {cpSync, existsSync, readFileSync, writeFileSync, rmSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const chromeZip = resolve(root, "yt-transcript-chrome.zip");
const firefoxZip = resolve(root, "yt-transcript-firefox.zip");

if (!existsSync(resolve(dist, "manifest.json"))) {
    console.error("dist/manifest.json not found. Run `npm run build` first.");
    process.exit(1);
}

// ── Chrome + Edge (identical, both accept MV3) ─────────────
if (existsSync(chromeZip)) rmSync(chromeZip);
execSync("zip -r ../yt-transcript-chrome.zip .", {cwd: dist, stdio: "inherit"});
console.log("✅ yt-transcript-chrome.zip (Chrome + Edge)");

// ── Firefox ─────────────────────────────────────────────────
const firefoxDist = resolve(root, "dist-firefox");
if (existsSync(firefoxDist)) rmSync(firefoxDist, {recursive: true});

// Copy dist to dist-firefox
cpSync(dist, firefoxDist, {recursive: true});

// Replace manifest with Firefox version
const firefoxManifest = resolve(root, "manifest.firefox.json");
if (!existsSync(firefoxManifest)) {
    console.error("manifest.firefox.json not found.");
    process.exit(1);
}
cpSync(firefoxManifest, resolve(firefoxDist, "manifest.json"));

// Strip Chrome-only sidePanel API from Firefox service worker
const swPath = resolve(firefoxDist, "background/service-worker.js");
if (existsSync(swPath)) {
    let sw = readFileSync(swPath, "utf-8");
    sw = sw.replace(/chrome\.sidePanel\.setPanelBehavior\([^)]*\);?/g, "/* removed: Chrome-only sidePanel API */");
    writeFileSync(swPath, sw);
    console.log("  → stripped sidePanel.setPanelBehavior from Firefox build");
}

if (existsSync(firefoxZip)) rmSync(firefoxZip);
execSync("zip -r ../yt-transcript-firefox.zip .", {cwd: firefoxDist, stdio: "inherit"});
rmSync(firefoxDist, {recursive: true});
console.log("✅ yt-transcript-firefox.zip (Firefox)");

console.log("\nDone. Upload:");
console.log("  Chrome:  https://chrome.google.com/webstore/devconsole");
console.log("  Edge:    https://partner.microsoft.com/dashboard/microsoftedge");
console.log("  Firefox: https://addons.mozilla.org/developers/");
