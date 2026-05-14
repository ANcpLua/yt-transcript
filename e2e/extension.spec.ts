/**
 * E2E smoke tests for the yt-transcript Chrome extension.
 *
 * These tests are intentionally narrow: they load the unpacked extension
 * from dist/ into a persistent Chromium context and confirm the side
 * panel HTML loads without crashing. They do NOT prove that transcript
 * extraction works — that proof lives in transcript-extraction.spec.ts.
 *
 * Run: npx playwright test e2e/extension.spec.ts
 */
import {test, expect, type BrowserContext, chromium} from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../dist");
const SIDE_PANEL = "sidepanel/index.html";

let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
    if (!fs.existsSync(path.join(DIST, "manifest.json"))) {
        throw new Error("dist/manifest.json not found. Run `npm run build` first.");
    }

    const userDataDir = path.join(__dirname, ".tmp-profile");
    context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: [
            `--disable-extensions-except=${DIST}`,
            `--load-extension=${DIST}`,
            "--no-first-run",
            "--disable-default-apps",
        ],
    });

    let sw = context.serviceWorkers()[0];
    if (!sw) {
        sw = await context.waitForEvent("serviceworker", {timeout: 10_000});
    }
    extensionId = sw.url().split("/")[2]!;
});

test.afterAll(async () => {
    await context?.close();
    const tmpDir = path.join(__dirname, ".tmp-profile");
    if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    }
});

test("extension service worker registers", async () => {
    expect(extensionId).toBeTruthy();
    expect(extensionId.length).toBe(32);
});

test("side panel HTML loads without crash", async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${SIDE_PANEL}`);
    await page.waitForLoadState("domcontentloaded");

    const root = page.locator("#root");
    await expect(root).toBeAttached();

    await page.close();
});

test("content script is registered for YouTube watch URLs", async () => {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(DIST, "manifest.json"), "utf-8")
    );

    const contentScripts = manifest.content_scripts;
    expect(Array.isArray(contentScripts)).toBe(true);
    expect(
        contentScripts.some((cs: {matches: string[]}) =>
            cs.matches.some((m) => m.includes("youtube.com/watch"))
        )
    ).toBe(true);
});
