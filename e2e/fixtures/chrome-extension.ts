import {test as base, expect, chromium, type BrowserContext, type ConsoleMessage, type Page, type Worker} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");
export const EXTENSION_DIST = path.join(REPO_ROOT, "packages/extension/dist-chrome");

interface ExtensionManifest {
    manifest_version?: number;
    action?: {
        default_popup?: string;
        default_title?: string;
    };
    background?: {
        service_worker?: string;
        type?: string;
    };
    side_panel?: {
        default_path?: string;
    };
    content_scripts?: {
        matches?: string[];
        js?: string[];
        run_at?: string;
        world?: string;
    }[];
}

interface ExtensionFixtures {
    extensionContext: BrowserContext;
    extensionId: string;
    extensionManifest: ExtensionManifest;
    extensionOrigin: string;
    fatalExtensionErrors: string[];
    openExtensionPage: (relativePath: string) => Promise<Page>;
}

function readManifest(): ExtensionManifest {
    const manifestPath = path.join(EXTENSION_DIST, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
        throw new Error(
            `Built Chrome extension manifest not found at ${manifestPath}. Run 'pnpm run build' first.`,
        );
    }
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ExtensionManifest;
}

function serviceWorkerPath(manifest: ExtensionManifest): string {
    const workerPath = manifest.background?.service_worker;
    if (!workerPath) throw new Error("manifest.background.service_worker is required for MV3 tests.");
    return workerPath;
}

function isExtensionUrl(url: string): boolean {
    return url.startsWith("chrome-extension://");
}

function messageLocation(message: ConsoleMessage): string {
    const location = message.location();
    return location.url ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : "unknown";
}

function attachPageErrorCapture(page: Page, fatalErrors: string[]): void {
    page.on("console", (message) => {
        const pageUrl = page.url();
        const sourceUrl = message.location().url;
        if (message.type() === "error" && (isExtensionUrl(pageUrl) || isExtensionUrl(sourceUrl))) {
            fatalErrors.push(`[console:${message.type()}] ${message.text()} (${messageLocation(message)})`);
        }
    });
    page.on("pageerror", (error) => {
        if (isExtensionUrl(page.url())) {
            fatalErrors.push(`[pageerror] ${error.message}`);
        }
    });
}

function attachWorkerErrorCapture(worker: Worker, fatalErrors: string[]): void {
    worker.on("console", (message) => {
        if (message.type() === "error" && isExtensionUrl(worker.url())) {
            fatalErrors.push(`[worker:${message.type()}] ${message.text()} (${messageLocation(message)})`);
        }
    });
}

async function findServiceWorker(context: BrowserContext, manifest: ExtensionManifest): Promise<Worker> {
    const workerPath = `/${serviceWorkerPath(manifest)}`;
    const existing = context.serviceWorkers().find((worker) => new URL(worker.url()).pathname === workerPath);
    if (existing) return existing;
    return context.waitForEvent("serviceworker", {
        predicate: (worker) => new URL(worker.url()).pathname === workerPath,
        timeout: 15_000,
    });
}

export const test = base.extend<ExtensionFixtures>({
    extensionManifest: async ({}, use) => {
        await use(readManifest());
    },

    fatalExtensionErrors: async ({}, use) => {
        const fatalErrors: string[] = [];
        await use(fatalErrors);
    },

    extensionContext: async ({extensionManifest, fatalExtensionErrors}, use, testInfo) => {
        const userDataDir = testInfo.outputPath("profile");
        const videoDir = testInfo.outputPath("videos");
        fs.rmSync(userDataDir, {recursive: true, force: true});
        fs.mkdirSync(videoDir, {recursive: true});

        const context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            locale: "en-US",
            viewport: {width: 420, height: 900},
            recordVideo: {
                dir: videoDir,
                size: {width: 420, height: 900},
            },
            args: [
                `--disable-extensions-except=${EXTENSION_DIST}`,
                `--load-extension=${EXTENSION_DIST}`,
                "--host-resolver-rules=MAP www.youtube.com 127.0.0.1",
                "--ignore-certificate-errors",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-default-apps",
                "--disable-features=DialMediaRouteProvider",
                "--lang=en-US",
            ],
        });

        context.pages().forEach((page) => attachPageErrorCapture(page, fatalExtensionErrors));
        context.on("page", (page) => attachPageErrorCapture(page, fatalExtensionErrors));
        context.serviceWorkers().forEach((worker) => attachWorkerErrorCapture(worker, fatalExtensionErrors));
        context.on("serviceworker", (worker) => attachWorkerErrorCapture(worker, fatalExtensionErrors));

        await use(context);

        const failed = testInfo.status !== testInfo.expectedStatus || fatalExtensionErrors.length > 0;
        const videoHandles = context.pages().map((page) => page.video()).filter((video) => video !== null);
        await context.close();

        if (failed) {
            for (const [index, video] of videoHandles.entries()) {
                const videoPath = await video.path().catch(() => null);
                if (videoPath) {
                    await testInfo.attach(`video-${index + 1}`, {path: videoPath, contentType: "video/webm"});
                }
            }
        } else {
            await Promise.all(videoHandles.map((video) => video.delete().catch(() => undefined)));
        }

        fs.rmSync(userDataDir, {recursive: true, force: true});
        if (fatalExtensionErrors.length > 0) {
            throw new Error(`Fatal extension console errors:\n${fatalExtensionErrors.join("\n")}`);
        }
    },

    extensionId: async ({extensionContext, extensionManifest}, use) => {
        const worker = await findServiceWorker(extensionContext, extensionManifest);
        const extensionId = new URL(worker.url()).host;
        expect(extensionId).toMatch(/^[a-p]{32}$/);
        await use(extensionId);
    },

    extensionOrigin: async ({extensionId}, use) => {
        await use(`chrome-extension://${extensionId}`);
    },

    openExtensionPage: async ({extensionContext, extensionOrigin}, use) => {
        await use(async (relativePath: string) => {
            const page = await extensionContext.newPage();
            await page.goto(`${extensionOrigin}/${relativePath}`);
            await page.waitForLoadState("domcontentloaded");
            return page;
        });
    },
});

export {expect};
