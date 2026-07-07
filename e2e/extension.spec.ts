import {test, expect, EXTENSION_DIST} from "./fixtures/chrome-extension";
import path from "node:path";

test("built extension registers the declared MV3 service worker", async ({
    extensionContext,
    extensionId,
    extensionManifest,
}) => {
    expect(path.basename(EXTENSION_DIST)).toBe("dist-chrome");
    expect(extensionManifest.manifest_version).toBe(3);
    expect(extensionManifest.background?.type).toBe("module");
    expect(extensionManifest.background?.service_worker).toBe("background/service-worker.js");

    const worker = extensionContext.serviceWorkers().find((candidate) => {
        return new URL(candidate.url()).host === extensionId;
    });
    expect(worker?.url()).toBe(`chrome-extension://${extensionId}/background/service-worker.js`);
});

test("declared action popup loads from manifest.action.default_popup", async ({
    extensionId,
    extensionManifest,
    openExtensionPage,
}) => {
    const popupPath = extensionManifest.action?.default_popup;
    expect(popupPath).toBeTruthy();

    const page = await openExtensionPage(popupPath ?? "");
    await expect(page.locator("#root")).toBeAttached();
    await expect(page).toHaveURL(`chrome-extension://${extensionId}/${popupPath}`);
});

test("content scripts stay scoped to Chrome MV3 YouTube watch interception", async ({extensionManifest}) => {
    const scripts = extensionManifest.content_scripts;
    expect(Array.isArray(scripts)).toBe(true);
    expect(
        scripts?.some((script) =>
            script.world === "MAIN" &&
            script.run_at === "document_start" &&
            script.js?.includes("content/yt-interceptor.js") &&
            script.matches?.some((match) => match.includes("youtube.com")),
        ),
    ).toBe(true);
    expect(
        scripts?.some((script) =>
            script.js?.includes("content/content.js") &&
            script.matches?.some((match) => match.includes("youtube.com/watch")),
        ),
    ).toBe(true);
});
