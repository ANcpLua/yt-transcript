/**
 * End-to-end reproducer for the paste-URL transcript-extraction failure.
 *
 * On a fresh install, pasting a YouTube URL into the side panel surfaces
 *   "Extension has not been invoked for the current page
 *    (see activeTab permission). Chrome pages cannot be captured."
 * because `no_captions` from the Innertube fallback triggers an
 * auto-Whisper path that calls `chrome.tabCapture.getMediaStreamId`
 * against whatever happens to be the current active tab — which is not
 * a YouTube tab at all.
 *
 * This test loads the unpacked extension, opens the side panel, pastes
 * the canonical reproducer URL, and asserts that ≥10 caption rows
 * appear in the transcript list. On `main` it fails; the next commit on
 * this branch makes it pass.
 *
 * Run: npm run build && npx playwright test e2e/transcript-extraction.spec.ts
 */
import {test, expect, type BrowserContext, type Page, chromium} from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DIST = path.join(REPO_ROOT, "dist");
const SIDE_PANEL_PATH = "sidepanel/index.html";

const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const REQUIRED_ROWS = 10;

function utcStamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
        `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
        `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
    );
}

const STAMP = utcStamp();
const SHOT_DIR = path.join(REPO_ROOT, "e2e", "screenshots", STAMP);

function ensureShotDir(): void {
    fs.mkdirSync(SHOT_DIR, {recursive: true});
}

async function dumpFailureArtifacts(page: Page, label: "01-repro-fail" | "02-before-fail"): Promise<{
    visibleRows: number;
    error: string;
    bodyText: string;
}> {
    ensureShotDir();
    const screenshot = path.join(SHOT_DIR, `${label}.png`);
    const textPath = path.join(SHOT_DIR, `${label}.txt`);

    const alertText = await page.locator('[role="alert"]').first().textContent().catch(() => "");
    const headingText = await page.locator('h2').first().textContent().catch(() => "");
    const bodyText = (await page.locator('body').textContent().catch(() => "")) ?? "";
    const visibleRows = await page.locator('[role="listitem"]').count().catch(() => 0);

    await page.screenshot({path: screenshot, fullPage: true});

    const dump = [
        `timestamp: ${new Date().toISOString()}`,
        `video_url: ${VIDEO_URL}`,
        `required_rows: ${REQUIRED_ROWS}`,
        `actual_rows: ${visibleRows}`,
        `heading: ${headingText ?? ""}`,
        `alert_text: ${(alertText ?? "").replace(/\s+/g, " ").trim()}`,
        ``,
        `--- body snapshot ---`,
        bodyText.replace(/\s+/g, " ").trim().slice(0, 4_000),
    ].join("\n");

    fs.writeFileSync(textPath, dump);
    return {visibleRows, error: (alertText ?? "").trim(), bodyText};
}

let context: BrowserContext;
let extensionId: string;
let userDataDir: string;

test.beforeAll(async () => {
    if (!fs.existsSync(path.join(DIST, "manifest.json"))) {
        throw new Error(
            `dist/manifest.json not found at ${DIST}. Run 'npm run build' before this test.`,
        );
    }

    userDataDir = path.join(REPO_ROOT, "e2e", ".tmp-profile-extract");
    if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, {recursive: true, force: true});

    context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: [
            `--disable-extensions-except=${DIST}`,
            `--load-extension=${DIST}`,
            "--no-first-run",
            "--disable-default-apps",
            "--disable-features=DialMediaRouteProvider",
        ],
    });

    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent("serviceworker", {timeout: 15_000});
    extensionId = sw.url().split("/")[2]!;
});

test.afterAll(async () => {
    await context?.close();
    if (userDataDir && fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, {recursive: true, force: true});
    }
});

test("paste-URL produces ≥10 caption rows", async () => {
    const page = await context.newPage();
    page.on("console", (msg) => {
        // Surface side-panel console errors into the Playwright trace so
        // a failure shows the activeTab/tabCapture path instead of just
        // "0 rows".
        if (msg.type() === "error" || msg.text().includes("[intercept]") ||
            msg.text().includes("tabCapture") || msg.text().includes("activeTab")) {
            console.log(`[page:${msg.type()}] ${msg.text()}`);
        }
    });

    await page.goto(`chrome-extension://${extensionId}/${SIDE_PANEL_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    const input = page.getByLabel("Video URL");
    await expect(input).toBeVisible({timeout: 15_000});

    await input.fill(VIDEO_URL);
    await page.getByRole("button", {name: /get transcript/i}).click();

    // Wait for either the transcript list to fill with ≥10 listitems
    // OR an error/no-transcript state to appear. Up to 45 s — Innertube
    // + optional watch-page scrape + segment parse is normally well
    // under 10 s; the extra headroom is for the broken-state fallback
    // paths. We use `allSettled` (not `race`) so the post-hoc log can
    // tell whether the rows leg fulfilled, the alert leg fulfilled,
    // both timed out, or both fired at once.
    const segmentRows = page.locator('[role="list"][aria-label="Transcript segments"] [role="listitem"]');
    const alert = page.locator('[role="alert"]');

    const [rowsLeg, alertLeg] = await Promise.allSettled([
        segmentRows.nth(REQUIRED_ROWS - 1).waitFor({state: "attached", timeout: 45_000}),
        alert.first().waitFor({state: "visible", timeout: 45_000}),
    ]);
    const settled =
        rowsLeg.status === "fulfilled" && alertLeg.status === "fulfilled" ? "rows+alert" :
        rowsLeg.status === "fulfilled" ? "rows" :
        alertLeg.status === "fulfilled" ? "alert" :
        "both-timeout";

    const result = await dumpFailureArtifacts(page, "01-repro-fail");

    console.log(
        `[repro] settled=${settled} rows=${result.visibleRows} ` +
        `alert="${result.error.replace(/\s+/g, " ").slice(0, 200)}"`,
    );

    // The assertion that fails on `main`: we need ≥10 caption rows
    // visible. On the broken build, the side panel either shows an
    // alert ("Extension has not been invoked for the current page…") or
    // sits at zero rows; either way this line throws.
    expect(
        result.visibleRows,
        `Expected ≥${REQUIRED_ROWS} caption rows for ${VIDEO_URL}, got ${result.visibleRows}. ` +
        `Alert text: "${result.error.slice(0, 400)}". ` +
        `Artifacts: ${path.relative(REPO_ROOT, SHOT_DIR)}/01-repro-fail.{png,txt}`,
    ).toBeGreaterThanOrEqual(REQUIRED_ROWS);

    await page.close();
});
