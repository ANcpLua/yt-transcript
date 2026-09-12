/**
 * Render the promo tile (440x280) and marquee (1400x560) for the store
 * listings from HTML: the extension icon, the name, and one sentence from
 * store/listing.md. Flat background, no arrows, no buttons, no browser names.
 *
 *   node scripts/store-images/promo.mjs
 */
import {chromium} from "@playwright/test";
import {readFileSync} from "node:fs";
import {resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const icon = `data:image/png;base64,${readFileSync(resolve(root, "store/logo/logo-1024-transparent.png")).toString("base64")}`;
const listing = readFileSync(resolve(root, "store/listing.md"), "utf8");
const tagline = listing.split(/^## Description$/m)[1].trim().split("\n")[0];

function html({width, height, iconSize, titleSize, textSize, gap}) {
    return `<!doctype html><html><head><style>
      html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
      body{display:flex;align-items:center;justify-content:center;gap:${gap}px;
           background:#f8fafc;
           font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0f172a}
      img{width:${iconSize}px;height:${iconSize}px;flex:none}
      .text{max-width:${width - iconSize - gap * 3}px}
      h1{margin:0 0 ${Math.round(titleSize / 4)}px;font-size:${titleSize}px;font-weight:700;letter-spacing:-0.01em}
      p{margin:0;font-size:${textSize}px;line-height:1.35;color:#334155}
    </style></head><body>
      <img src="${icon}" alt="">
      <div class="text"><h1>Video Transcript</h1><p>${tagline}</p></div>
    </body></html>`;
}

const targets = [
    {file: "tile-440x280.png", width: 440, height: 280, iconSize: 120, titleSize: 30, textSize: 15, gap: 24},
    {file: "marquee-1400x560.png", width: 1400, height: 560, iconSize: 300, titleSize: 76, textSize: 34, gap: 64},
];

const browser = await chromium.launch();
for (const target of targets) {
    const page = await browser.newPage({viewport: {width: target.width, height: target.height}, deviceScaleFactor: 1});
    await page.setContent(html(target));
    const out = resolve(root, "store/images", target.file);
    await page.screenshot({path: out, type: "png"});
    console.log(`✓ ${target.file}`);
    await page.close();
}
await browser.close();
