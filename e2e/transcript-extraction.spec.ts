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

test("local fixture uses the optional page adapter after generic discovery", async ({
    extensionContext,
    extensionId,
    extensionManifest,
    openExtensionPage,
}) => {
    const sidePanelPath = extensionManifest.side_panel?.default_path;
    expect(sidePanelPath).toBeTruthy();

    const unexpectedNetwork: string[] = [];
    extensionContext.on("request", (request) => {
        const url = request.url();
        if (!url.startsWith("http://") && !url.startsWith("https://")) return;
        const parsed = new URL(url);
        if (parsed.hostname !== fixtureServer.originHost) {
            unexpectedNetwork.push(url);
        }
    });

    const panel = await openExtensionPage(sidePanelPath ?? "");
    await panel.setViewportSize({width: 400, height: 900});

    const watchPage = await extensionContext.newPage();
    await watchPage.goto(`${fixtureServer.baseUrl}/watch?v=${FIXTURE_VIDEO_ID}`, {
        waitUntil: "domcontentloaded",
    });

    const browserInstance = extensionContext.browser();
    expect(browserInstance).not.toBeNull();
    const browserSession = await browserInstance!.newBrowserCDPSession();
    const targets = await browserSession.send("Target.getTargets", {
        filter: [{type: "tab"}],
    }) as {
        targetInfos: {targetId: string; type: string; url: string}[];
    };
    const tabTarget = targets.targetInfos.find((target) =>
        target.type === "tab" && target.url === `${fixtureServer.baseUrl}/watch?v=${FIXTURE_VIDEO_ID}`
    );
    expect(tabTarget).toBeDefined();
    await browserSession.send("Extensions.triggerAction", {
        id: extensionId,
        targetId: tabTarget!.targetId,
    });

    await expect
        .poll(
            async () =>
                panel
                    .locator('[role="list"][aria-label="Transcript segments"] [role="listitem"]')
                    .count(),
            {
                message: "fixture transcript rows should arrive through intercepted-transcript",
                timeout: 30_000,
            },
        )
        .toBeGreaterThanOrEqual(FIXTURE_SEGMENTS.length);

    await expect(panel.getByText("Local Fixture Transcript")).toBeVisible();
    await expect(panel.getByText(FIXTURE_SEGMENTS[0])).toBeVisible();
    await expect(panel.getByText(FIXTURE_SEGMENTS[FIXTURE_SEGMENTS.length - 1])).toBeVisible();

    const horizontalOverflow = await panel.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth > root.clientWidth;
    });
    expect(horizontalOverflow).toBe(false);
    expect(unexpectedNetwork).toEqual([]);
    await browserSession.detach();
});
