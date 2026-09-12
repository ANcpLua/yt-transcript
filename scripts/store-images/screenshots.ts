/**
 * Real side-panel screenshots for the store listings, 1280x800 each: the
 * fixture media page on the left (880 px) and the panel on the right (400 px),
 * the way the panel sits beside a page in the browser. The fixture page is
 * local, unbranded, and served through Playwright routing.
 *
 *   bun run build
 *   bunx playwright test --config scripts/store-images/playwright.config.ts
 */
import {test, expect} from "../../e2e/fixtures/chrome-extension";
import {execFileSync} from "node:child_process";
import {mkdirSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import type {Page} from "@playwright/test";
import {fileURLToPath} from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

const OUT = resolve(here, "../../store/images");
const TMP = resolve(here, "../../test-results/store-images/parts");
const PAGE_WIDTH = 880;
const PANEL_WIDTH = 400;
const HEIGHT = 800;

const CUES: [number, number, string][] = [
    [0, 4, "Welcome back. Today we look at sampling: turning a continuous signal into numbers."],
    [4, 9, "The sampling theorem says the rate must exceed twice the highest frequency present."],
    [9, 14, "Below that rate, high frequencies fold back into the band and appear as lower ones."],
    [14, 18, "That folding is aliasing, and once it has happened no filter can undo it."],
    [18, 23, "So the anti-aliasing filter always sits before the converter, never after it."],
    [23, 28, "Let's see it on the oscilloscope with a one kilohertz tone sampled at 1.5 kilohertz."],
    [28, 33, "The reconstructed tone comes out at 500 hertz, which is exactly the folded frequency."],
    [33, 38, "Audio uses 44.1 or 48 kilohertz because hearing stops near 20 kilohertz."],
    [38, 43, "Video does the same in space: fine stripes on a shirt turn into moire patterns."],
    [43, 48, "Next week we quantise the samples and meet the second source of error."],
];

function vtt(): string {
    const stamp = (s: number) => `00:00:${String(s).padStart(2, "0")}.000`;
    return ["WEBVTT", "", ...CUES.flatMap(([a, b, text]) => [`${stamp(a)} --> ${stamp(b)}`, text, ""])].join("\n");
}

function pageHtml(title: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
      body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;color:#1f2937}
      header{display:flex;align-items:center;gap:12px;padding:16px 28px;background:#fff;border-bottom:1px solid #e5e7eb}
      header b{font-size:15px} header span{color:#6b7280;font-size:13px}
      main{padding:24px 28px;max-width:824px}
      .player{aspect-ratio:16/9;background:#0f172a;border-radius:12px;overflow:hidden}
      video{width:100%;height:100%;display:block}
      h1{font-size:21px;margin:18px 0 6px}
      p{color:#6b7280;line-height:1.5;margin:0 0 10px;font-size:14px}
    </style></head><body>
      <header><b>Open Courseware</b><span>Signals and Systems</span></header>
      <main>
        <div class="player"><video id="lecture" controls preload="none"><track kind="captions" srclang="en" label="English" src="/captions.vtt"></video></div>
        <h1>${title}</h1>
        <p>Recorded lecture, 48 minutes. Captions available.</p>
      </main>
    </body></html>`;
}

async function compose(name: string, pagePart: Buffer, panelPart: Buffer, anchorBottom = false): Promise<void> {
    mkdirSync(TMP, {recursive: true});
    const left = resolve(TMP, `${name}-page.png`);
    const right = resolve(TMP, `${name}-panel.png`);
    writeFileSync(left, pagePart);
    writeFileSync(right, panelPart);
    execFileSync("python3", ["-c", `
from PIL import Image
page = Image.open(${JSON.stringify(left)}).convert("RGB")
panel = Image.open(${JSON.stringify(right)}).convert("RGB")
canvas = Image.new("RGB", (${PAGE_WIDTH + PANEL_WIDTH}, ${HEIGHT}), "#ffffff")
canvas.paste(page.crop((0, 0, ${PAGE_WIDTH}, ${HEIGHT})), (0, 0))
top = max(0, panel.height - ${HEIGHT}) if ${anchorBottom ? "True" : "False"} else 0
# A full-page capture drops the scrollbar and comes out narrower; fill the
# remainder with the panel's own background before pasting.
canvas.paste(panel.getpixel((0, 0)), (${PAGE_WIDTH}, 0, ${PAGE_WIDTH + PANEL_WIDTH}, ${HEIGHT}))
canvas.paste(panel.crop((0, top, min(panel.width, ${PANEL_WIDTH}), top + ${HEIGHT})), (${PAGE_WIDTH}, 0))
for y in range(${HEIGHT}):
    canvas.putpixel((${PAGE_WIDTH}, y), (229, 231, 235))
canvas.save(${JSON.stringify(resolve(OUT, `${name}.png`))}, optimize=True)
`]);
}

async function shot(page: Page): Promise<Buffer> {
    return page.screenshot({type: "png"});
}

test("store screenshots", async ({extensionContext, extensionId, extensionManifest, openExtensionPage}) => {
    await extensionContext.route("https://lecture.example/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/captions.vtt")) {
            await route.fulfill({status: 200, contentType: "text/vtt", body: vtt()});
            return;
        }
        const title = url.pathname.includes("lecture-4")
            ? "Lecture 4: Quantisation and Noise"
            : "Lecture 3: Sampling and Aliasing";
        await route.fulfill({status: 200, contentType: "text/html", body: pageHtml(title)});
    });

    const panel = await openExtensionPage(extensionManifest.side_panel?.default_path ?? "");
    await panel.setViewportSize({width: PANEL_WIDTH, height: HEIGHT});
    await panel.emulateMedia({colorScheme: "light"});

    const videoTab = await extensionContext.newPage();
    await videoTab.setViewportSize({width: PAGE_WIDTH, height: HEIGHT});
    await videoTab.goto("https://lecture.example/lecture-3");
    await videoTab.bringToFront();

    const browserSession = await extensionContext.browser()!.newBrowserCDPSession();
    const triggerOn = async (url: string) => {
        const targets = await browserSession.send("Target.getTargets", {filter: [{type: "tab"}]}) as {
            targetInfos: {targetId: string; type: string; url: string}[];
        };
        const target = targets.targetInfos.find((t) => t.type === "tab" && t.url === url);
        expect(target).toBeDefined();
        await browserSession.send("Extensions.triggerAction", {id: extensionId, targetId: target!.targetId});
    };

    // 01: transcript loaded from the page's own captions
    await triggerOn("https://lecture.example/lecture-3");
    await expect(panel.getByText(CUES[0][2])).toBeVisible({timeout: 15_000});
    await expect(panel.getByText("Native", {exact: true})).toBeVisible();
    await panel.waitForTimeout(500);
    const pagePart = await shot(videoTab);
    await compose("screenshot-01-transcript", pagePart, await shot(panel));

    // 02: search
    await panel.getByLabel("Search transcript").fill("kilohertz");
    await panel.waitForTimeout(400);
    await compose("screenshot-02-search", pagePart, await shot(panel));
    await panel.getByLabel("Search transcript").fill("");

    // 03: export menu. It opens below the export bar at the panel's bottom
    // edge, so capture the full document and keep its lowest 800 px.
    await panel.locator("summary", {hasText: "Export"}).first().click();
    await panel.waitForTimeout(400);
    await compose("screenshot-03-export", pagePart, await panel.screenshot({type: "png", fullPage: true}), true);
    await panel.keyboard.press("Escape");
    await panel.waitForTimeout(200);

    // 04: pasted URL, waiting for the click on the toolbar action
    const urlInput = panel.getByLabel("Video URL").first();
    await urlInput.fill("https://lecture.example/lecture-4");
    await urlInput.press("Enter");
    const lectureFour = await extensionContext.waitForEvent("page");
    await lectureFour.waitForLoadState("domcontentloaded");
    // The tab was opened by the extension before routing attached; reload so
    // the fixture route serves it.
    await lectureFour.setViewportSize({width: PAGE_WIDTH, height: HEIGHT});
    await lectureFour.reload();
    await lectureFour.waitForLoadState("load");
    await expect(panel.getByText("toolbar icon", {exact: false})).toBeVisible({timeout: 10_000});
    await panel.waitForTimeout(400);
    await compose("screenshot-04-pasted-url", await shot(lectureFour), await shot(panel));

    // 05: settings
    await panel.getByTitle("Settings").first().click();
    await panel.waitForTimeout(400);
    await compose("screenshot-05-settings", await shot(lectureFour), await shot(panel));

    await browserSession.detach();
});
