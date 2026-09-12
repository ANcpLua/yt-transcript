/**
 * Package the extension for the stores. Run after `npm run build`.
 *
 * Names follow store.config.json (`<zipPrefix>-<store>-<version>.zip`), which
 * is what the store-publish tool expects:
 *   video-transcript-chrome-<version>.zip   Chrome Web Store
 *   video-transcript-edge-<version>.zip     Edge Add-ons (Chromium build with manifest.edge.json, no tab audio)
 *   video-transcript-firefox-<version>.zip  Firefox Add-ons
 *   video-transcript-source-<version>.zip   source archive AMO requires for bundled builds
 */
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync, rmSync} from "node:fs";
import {resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(resolve(root, "store.config.json"), "utf8"));
const version = JSON.parse(readFileSync(resolve(root, config.versionFrom), "utf8")).version;
const name = (kind) => `${config.zipPrefix}-${kind}-${version}.zip`;

const targets = [
    {kind: "chrome", dir: resolve(root, "dist")},
    {kind: "edge", dir: resolve(root, "packages/extension/dist-edge")},
    {kind: "firefox", dir: resolve(root, "packages/extension/dist-firefox")},
];

for (const {kind, dir} of targets) {
    if (!existsSync(resolve(dir, "manifest.json"))) {
        console.error(`${dir}/manifest.json not found. Run \`npm run build\` first.`);
        process.exit(1);
    }
    const zip = resolve(root, name(kind));
    rmSync(zip, {force: true});
    execFileSync("zip", ["-qr", zip, "."], {cwd: dir, stdio: "inherit"});
    console.log(`✓ ${name(kind)}`);
}

const sourceZip = resolve(root, name("source"));
rmSync(sourceZip, {force: true});
execFileSync("git", ["archive", "--format=zip", "-o", sourceZip, "HEAD"], {cwd: root, stdio: "inherit"});
console.log(`✓ ${name("source")}`);
