/**
 * Package the extension for the Chrome Web Store.
 * Run after `npm run build` — expects dist/ to exist.
 *
 * Outputs:
 *   yt-transcript-chrome.zip  — Chrome Web Store.
 */
import {execSync} from "child_process";
import {existsSync, rmSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const chromeZip = resolve(root, "yt-transcript-chrome.zip");

if (!existsSync(resolve(dist, "manifest.json"))) {
    console.error("dist/manifest.json not found. Run `npm run build` first.");
    process.exit(1);
}

if (existsSync(chromeZip)) rmSync(chromeZip);
execSync("zip -r ../yt-transcript-chrome.zip .", {cwd: dist, stdio: "inherit"});
console.log("✅ yt-transcript-chrome.zip");

console.log("\nDone. Upload to:");
console.log("  https://chrome.google.com/webstore/devconsole");
