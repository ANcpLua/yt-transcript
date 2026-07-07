import {test, expect} from "./fixtures/chrome-extension";
import {
    FIXTURE_SEGMENTS,
    FIXTURE_VIDEO_ID,
    startYouTubeFixtureServer,
    type YouTubeFixtureServer,
} from "./fixtures/youtube-fixture-server";

let fixtureServer: YouTubeFixtureServer;

test.beforeAll(async () => {
    fixtureServer = await startYouTubeFixtureServer();
});

test.afterAll(async () => {
    await fixtureServer.close();
});

test("local fixture watch page auto-populates transcript through the MV3 interceptor", async ({
    extensionContext,
    extensionManifest,
    openExtensionPage,
}) => {
    const popupPath = extensionManifest.action?.default_popup;
    expect(popupPath).toBeTruthy();

    const unexpectedNetwork: string[] = [];
    extensionContext.on("request", (request) => {
        const url = request.url();
        if (!url.startsWith("http://") && !url.startsWith("https://")) return;
        const parsed = new URL(url);
        if (parsed.hostname !== fixtureServer.originHost) {
            unexpectedNetwork.push(url);
        }
    });

    const popup = await openExtensionPage(popupPath ?? "");
    await popup.setViewportSize({width: 400, height: 900});

    const watchPage = await extensionContext.newPage();
    await watchPage.goto(`${fixtureServer.baseUrl}/watch?v=${FIXTURE_VIDEO_ID}`, {
        waitUntil: "domcontentloaded",
    });

    await expect
        .poll(
            async () =>
                popup
                    .locator('[role="list"][aria-label="Transcript segments"] [role="listitem"]')
                    .count(),
            {
                message: "fixture transcript rows should arrive through intercepted-transcript",
                timeout: 30_000,
            },
        )
        .toBeGreaterThanOrEqual(FIXTURE_SEGMENTS.length);

    await expect(popup.getByText("Local Fixture Transcript")).toBeVisible();
    await expect(popup.getByText(FIXTURE_SEGMENTS[0])).toBeVisible();
    await expect(popup.getByText(FIXTURE_SEGMENTS[FIXTURE_SEGMENTS.length - 1])).toBeVisible();

    const horizontalOverflow = await popup.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth > root.clientWidth;
    });
    expect(horizontalOverflow).toBe(false);
    expect(unexpectedNetwork).toEqual([]);
});
