import {test, expect, EXTENSION_DIST} from "./fixtures/chrome-extension";
import path from "node:path";
import fs from "node:fs";

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

test("toolbar action opens the declared side-panel entry point", async ({
    extensionId,
    extensionManifest,
    openExtensionPage,
}) => {
    expect(extensionManifest.action?.default_popup).toBeUndefined();
    const sidePanelPath = extensionManifest.side_panel?.default_path;
    expect(sidePanelPath).toBeTruthy();

    const page = await openExtensionPage(sidePanelPath ?? "");
    await expect(page.locator("#root")).toBeAttached();
    await expect(page).toHaveURL(`chrome-extension://${extensionId}/${sidePanelPath}`);
});

test("generic discovery is user-invoked without permanent all-site access", async ({extensionManifest}) => {
    const scripts = extensionManifest.content_scripts;
    expect(scripts).toBeUndefined();
    expect(extensionManifest.permissions).toEqual(expect.arrayContaining(["activeTab", "scripting"]));
    expect(extensionManifest.host_permissions ?? []).toEqual([]);
    expect(extensionManifest.optional_host_permissions).toEqual(["http://*/*", "https://*/*"]);
    expect(fs.existsSync(path.join(EXTENSION_DIST, "content/timed-text-main.js"))).toBe(true);
    expect(fs.existsSync(path.join(EXTENSION_DIST, "content/timed-text-bridge.js"))).toBe(true);
    expect(fs.existsSync(path.join(EXTENSION_DIST, "content/adapters/youtube.js"))).toBe(true);
});

test("arbitrary media URLs enter the user-granted page discovery flow at 400px", async ({
    extensionContext,
    extensionManifest,
    openExtensionPage,
}) => {
    const sidePanelPath = extensionManifest.side_panel?.default_path;
    expect(sidePanelPath).toBeTruthy();

    const pastedUrl = "https://vimeo.com/915999269?fl=pl&amp;fe=cm";
    const targetUrl = "https://vimeo.com/915999269?fl=pl&fe=cm";
    await extensionContext.route("https://vimeo.com/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<!doctype html><title>Fixture video</title><video controls></video>",
        });
    });

    const panel = await openExtensionPage(sidePanelPath ?? "");
    await panel.setViewportSize({width: 400, height: 900});
    await expect(panel.getByRole("button", {name: "Find transcript on current tab"})).toBeVisible();

    await panel.getByLabel("Video URL").fill(pastedUrl);
    const submit = panel.getByRole("button", {name: "Open and find transcript"});
    await expect(submit).toBeVisible();

    await submit.click();
    await expect.poll(() =>
        extensionContext.pages().some((page) => page.url() === targetUrl)
    ).toBe(true);
    const videoTab = extensionContext.pages().find((page) => page.url() === targetUrl);
    if (!videoTab) {
        throw new Error("The pasted media URL did not open in a new tab");
    }
    await videoTab.waitForURL(targetUrl);

    await expect(panel.getByText("One page-access click")).toBeVisible();
    await expect(panel.getByText("Ready to inspect the opened media page")).toBeVisible();
    await expect(panel.getByText("Enter a valid video URL")).toHaveCount(0);

    const horizontalOverflow = await panel.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth > root.clientWidth;
    });
    expect(horizontalOverflow).toBe(false);
});

test("paused current-tab media resolves runtime and WebVTT tracks before audio", async ({
    extensionContext,
    extensionId,
    extensionManifest,
    openExtensionPage,
}) => {
    await extensionContext.route("https://current-tab.test/**", async (route) => {
        if (route.request().url().endsWith("/captions.vtt")) {
            await route.fulfill({
                status: 200,
                contentType: "text/vtt",
                body: [
                    "WEBVTT",
                    "",
                    "00:00:01.000 --> 00:00:03.000",
                    "Premier sous-titre",
                    "",
                    "00:00:03.000 --> 00:00:05.000",
                    "Deuxième sous-titre",
                ].join("\n"),
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: [
                "<!doctype html>",
                "<title>Current tab fixture</title>",
                '<video id="fixture-player" controls><track kind="captions" srclang="fr" label="French" src="/captions.vtt"></video>',
                "<script>",
                'const runtimeTrack = document.querySelector("#fixture-player").addTextTrack("captions", "English runtime", "en");',
                'runtimeTrack.mode = "hidden";',
                'runtimeTrack.addCue(new VTTCue(1, 3, "First runtime cue"));',
                'runtimeTrack.addCue(new VTTCue(3, 5, "Second runtime cue"));',
                "</script>",
            ].join(""),
        });
    });

    const sidePanelPath = extensionManifest.side_panel?.default_path;
    const panel = await openExtensionPage(sidePanelPath ?? "");
    const videoTab = await extensionContext.newPage();
    await videoTab.goto("https://current-tab.test/video");
    await videoTab.bringToFront();

    const browserInstance = extensionContext.browser();
    expect(browserInstance).not.toBeNull();
    const browserSession = await browserInstance!.newBrowserCDPSession();
    const targets = await browserSession.send("Target.getTargets", {
        filter: [{type: "tab"}],
    }) as {
        targetInfos: {targetId: string; type: string; url: string}[];
    };
    const tabTarget = targets.targetInfos.find((target) =>
        target.type === "tab" && target.url === "https://current-tab.test/video"
    );
    expect(tabTarget).toBeDefined();
    await browserSession.send("Extensions.triggerAction", {
        id: extensionId,
        targetId: tabTarget!.targetId,
    });

    await expect(panel.getByText("First runtime cue")).toBeVisible({timeout: 10_000});
    await expect(panel.getByText("Second runtime cue")).toBeVisible();
    await expect(panel.getByText("Native", {exact: true})).toBeVisible();
    await expect(panel.getByRole("option", {name: "French"})).toBeAttached();
    const discovery = await panel.evaluate(() => chrome.runtime.sendMessage({
        type: "get-discovery-state",
    })) as {status?: string; data?: {tracks?: {name?: string}[]}};
    expect(discovery.status).toBe("found");
    expect(discovery.data?.tracks?.map((track) => track.name)).toContain("French");
    const sessionKeys = await panel.evaluate(async () =>
        Object.keys(await chrome.storage.session.get(null))
    );
    expect(sessionKeys.some((key) => key.startsWith("page-discovery-session:"))).toBe(true);
    await panel.getByLabel("Language").selectOption({label: "French"});
    await expect(panel.getByText("Premier sous-titre")).toBeVisible();
    await expect(panel.getByText("Deuxième sous-titre")).toBeVisible();
    await expect(panel.getByText("Chrome AI", {exact: false})).toHaveCount(0);
    expect(await videoTab.locator("video").evaluate((video) => (video as HTMLVideoElement).paused))
        .toBe(true);
    await browserSession.detach();
});

test("cross-origin WebVTT is fetched by the extension after an exact-origin grant", async ({
    extensionContext,
    extensionId,
    extensionManifest,
    openExtensionPage,
}) => {
    await extensionContext.route("https://permission.test/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: [
                "<!doctype html>",
                "<title>Cross-origin fixture</title>",
                "<meta http-equiv=\"Content-Security-Policy\" content=\"connect-src 'self'; script-src 'none'\">",
                '<video controls><track kind="captions" srclang="en" label="English" ',
                'src="https://captions-cdn.test/captions.vtt"></video>',
            ].join(""),
        });
    });
    await extensionContext.route("https://captions-cdn.test/**", async (route) => {
        const extensionRequest = route.request().headers()["origin"]?.startsWith("chrome-extension://");
        await route.fulfill({
            status: 200,
            contentType: "text/vtt",
            ...(extensionRequest
                ? {headers: {"access-control-allow-origin": "*"}}
                : {}),
            body: [
                "WEBVTT",
                "",
                "00:00:01.000 --> 00:00:03.000",
                "Fetched outside page CSP",
            ].join("\n"),
        });
    });

    const sidePanelPath = extensionManifest.side_panel?.default_path;
    const panel = await openExtensionPage(sidePanelPath ?? "");
    const videoTab = await extensionContext.newPage();
    await videoTab.goto("https://permission.test/video");
    await videoTab.bringToFront();

    const browserInstance = extensionContext.browser();
    expect(browserInstance).not.toBeNull();
    const browserSession = await browserInstance!.newBrowserCDPSession();
    const targets = await browserSession.send("Target.getTargets", {
        filter: [{type: "tab"}],
    }) as {
        targetInfos: {targetId: string; type: string; url: string}[];
    };
    const tabTarget = targets.targetInfos.find((target) =>
        target.type === "tab" && target.url === "https://permission.test/video"
    );
    expect(tabTarget).toBeDefined();
    await browserSession.send("Extensions.triggerAction", {
        id: extensionId,
        targetId: tabTarget!.targetId,
    });

    const inspect = panel.getByRole("button", {name: "Inspect media sources"});
    await expect(inspect).toBeVisible({timeout: 10_000});
    const worker = extensionContext.serviceWorkers().find((candidate) =>
        new URL(candidate.url()).host === extensionId
    );
    expect(worker).toBeDefined();
    await worker!.evaluate(() => {
        Object.defineProperty(chrome.permissions, "contains", {
            configurable: true,
            value: async (request: chrome.permissions.Permissions) =>
                request.origins?.includes("https://captions-cdn.test/*") === true,
        });
    });
    await panel.evaluate(() => {
        const root = globalThis as typeof globalThis & {
            __requestedTestOrigins?: string[];
        };
        Object.defineProperty(chrome.permissions, "request", {
            configurable: true,
            value: async (request: chrome.permissions.Permissions) => {
                root.__requestedTestOrigins = request.origins ?? [];
                return true;
            },
        });
    });
    await inspect.click();
    await expect(panel.getByText("Fetched outside page CSP")).toBeVisible({timeout: 10_000});
    await expect(panel.getByText("Native", {exact: true})).toBeVisible();
    expect(await panel.evaluate(() =>
        (globalThis as typeof globalThis & {
            __requestedTestOrigins?: string[];
        }).__requestedTestOrigins
    )).toEqual(["https://captions-cdn.test/*"]);
    const discovery = await panel.evaluate(() => chrome.runtime.sendMessage({
        type: "get-discovery-state",
    })) as {status?: string; data?: {tracks?: {name?: string}[]}};
    expect(discovery.status).toBe("found");
    expect(discovery.data?.tracks).toEqual([
        expect.objectContaining({name: "English"}),
    ]);
    await browserSession.detach();
});

test("Prompt API availability probes always declare an output language", async ({
    extensionContext,
    extensionManifest,
    openExtensionPage,
}) => {
    await extensionContext.addInitScript(() => {
        const root = globalThis as typeof globalThis & {
            __languageModelOptions?: unknown[];
            LanguageModel?: unknown;
        };
        root.__languageModelOptions = [];
        Object.defineProperty(root, "LanguageModel", {
            configurable: true,
            value: {
                availability: async (options: unknown) => {
                    root.__languageModelOptions?.push(options);
                    return "unavailable";
                },
            },
        });
    });

    const sidePanelPath = extensionManifest.side_panel?.default_path;
    const panel = await openExtensionPage(sidePanelPath ?? "");
    await panel.getByTitle("Settings").click();
    await expect(panel.getByText("Chrome AI — unavailable")).toBeVisible();

    const calls = await panel.evaluate(() => {
        const root = globalThis as typeof globalThis & {
            __languageModelOptions?: {
                outputLanguage?: string;
                expectedOutputs?: {type?: string; languages?: string[]}[];
            }[];
        };
        return root.__languageModelOptions ?? [];
    });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const options of calls) {
        expect(options.outputLanguage).toBe("en");
        expect(options.expectedOutputs).toEqual([{type: "text", languages: ["en"]}]);
    }
});

test("offscreen audio availability and create share language options and complete a file transcript", async ({
    extensionContext,
    extensionId,
    extensionManifest,
    openExtensionPage,
}) => {
    const worker = extensionContext.serviceWorkers().find((candidate) =>
        new URL(candidate.url()).host === extensionId
    );
    expect(worker).toBeDefined();
    await worker!.evaluate(async () => {
        const offscreenUrl = chrome.runtime.getURL("offscreen/offscreen.html");
        const contexts = await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
            documentUrls: [offscreenUrl],
        });
        if (contexts.length === 0) {
            await chrome.offscreen.createDocument({
                url: "offscreen/offscreen.html",
                reasons: [chrome.offscreen.Reason.USER_MEDIA],
                justification: "Test on-device transcription",
            });
        }
    });
    const browserInstance = extensionContext.browser();
    expect(browserInstance).not.toBeNull();
    const browserSession = await browserInstance!.newBrowserCDPSession();
    const targets = await browserSession.send("Target.getTargets") as {
        targetInfos: {targetId: string; type: string; url: string}[];
    };
    const offscreenTarget = targets.targetInfos.find((target) =>
        target.url.endsWith("/offscreen/offscreen.html")
    );
    expect(offscreenTarget).toBeDefined();
    const attached = await browserSession.send("Target.attachToTarget", {
        targetId: offscreenTarget!.targetId,
        flatten: false,
    }) as {sessionId: string};
    let commandId = 0;
    const sendToOffscreen = async (
        method: string,
        params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
        const id = ++commandId;
        const response = new Promise<Record<string, unknown>>((resolve, reject) => {
            const timeout = setTimeout(() => {
                browserSession.off("Target.receivedMessageFromTarget", listener);
                reject(new Error(`Timed out waiting for ${method}`));
            }, 10_000);
            const listener = (event: {sessionId: string; message: string}) => {
                if (event.sessionId !== attached.sessionId) return;
                const payload = JSON.parse(event.message) as {
                    id?: number;
                    result?: Record<string, unknown>;
                    error?: {message?: string};
                };
                if (payload.id !== id) return;
                clearTimeout(timeout);
                browserSession.off("Target.receivedMessageFromTarget", listener);
                if (payload.error) {
                    reject(new Error(payload.error.message ?? `${method} failed`));
                } else {
                    resolve(payload.result ?? {});
                }
            };
            browserSession.on("Target.receivedMessageFromTarget", listener);
        });
        await browserSession.send("Target.sendMessageToTarget", {
            sessionId: attached.sessionId,
            message: JSON.stringify({id, method, params}),
        });
        return response;
    };
    const installResult = await sendToOffscreen("Runtime.evaluate", {
        expression: `(() => {
            const snapshotOptions = (value) => {
                if (!value || typeof value !== "object") return {};
                return {
                    expectedInputs: value.expectedInputs,
                    expectedOutputs: value.expectedOutputs,
                    outputLanguage: value.outputLanguage,
                };
            };
            const session = {
                prompt: async () => "fixture transcript",
                clone: async () => session,
                destroy: () => undefined,
            };
            Object.defineProperty(globalThis, "LanguageModel", {
                configurable: true,
                value: {
                    availability: async (options) => {
                        globalThis.__audioAvailabilityOptions = snapshotOptions(options);
                        return "available";
                    },
                    create: async (options) => {
                        globalThis.__audioCreateOptions = snapshotOptions(options);
                        return session;
                    },
                },
            });
        })()`,
        awaitPromise: true,
        returnByValue: true,
    });
    expect(installResult.exceptionDetails).toBeUndefined();

    const sidePanelPath = extensionManifest.side_panel?.default_path;
    const panel = await openExtensionPage(sidePanelPath ?? "");
    const result = await panel.evaluate(() => {
        const sampleRate = 16_000;
        const sampleCount = sampleRate * 2;
        const wav = new ArrayBuffer(44 + sampleCount * 2);
        const view = new DataView(wav);
        const writeText = (offset: number, value: string) => {
            for (let index = 0; index < value.length; index++) {
                view.setUint8(offset + index, value.charCodeAt(index));
            }
        };
        writeText(0, "RIFF");
        view.setUint32(4, 36 + sampleCount * 2, true);
        writeText(8, "WAVE");
        writeText(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeText(36, "data");
        view.setUint32(40, sampleCount * 2, true);
        for (let index = 0; index < sampleCount; index++) {
            const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.1;
            view.setInt16(44 + index * 2, Math.round(sample * 0x7fff), true);
        }

        const blobUrl = URL.createObjectURL(new Blob([wav], {type: "audio/wav"}));
        return new Promise<{type: string; error?: string; segments?: {text: string}[]}>(
            (resolve) => {
                const timeout = window.setTimeout(() => {
                    chrome.runtime.onMessage.removeListener(listener);
                    URL.revokeObjectURL(blobUrl);
                    resolve({type: "timeout"});
                }, 20_000);
                const listener = (message: {
                    type?: string;
                    error?: string;
                    segments?: {text: string}[];
                    videoId?: string;
                }) => {
                    if (message.type !== "transcription-complete" &&
                        message.type !== "transcription-error") return;
                    window.clearTimeout(timeout);
                    chrome.runtime.onMessage.removeListener(listener);
                    URL.revokeObjectURL(blobUrl);
                    resolve({
                        type: message.type,
                        error: message.error,
                        segments: message.segments,
                    });
                };
                chrome.runtime.onMessage.addListener(listener);
                chrome.runtime.sendMessage({
                    type: "transcribe-file",
                    blobUrl,
                    videoId: "file-language-options",
                    title: "Language options fixture",
                });
            },
        );
    });

    expect(result).toEqual({
        type: "transcription-complete",
        error: undefined,
        segments: [{start: 0, duration: 2, text: "fixture transcript"}],
    });
    const recordedResult = await sendToOffscreen("Runtime.evaluate", {
        expression: `({
            audioAvailabilityOptions: globalThis.__audioAvailabilityOptions,
            audioCreateOptions: globalThis.__audioCreateOptions,
        })`,
        returnByValue: true,
    });
    const recordedOptions = (recordedResult.result as {
        value?: {
            audioAvailabilityOptions?: unknown;
            audioCreateOptions?: unknown;
        };
    } | undefined)?.value ?? {};
    const expectedOptions = {
        expectedInputs: [
            {type: "audio", languages: ["en"]},
            {type: "text", languages: ["en"]},
        ],
        expectedOutputs: [{type: "text", languages: ["en"]}],
        outputLanguage: "en",
    };
    expect(recordedOptions.audioAvailabilityOptions).toEqual(expectedOptions);
    expect(recordedOptions.audioCreateOptions).toEqual(expectedOptions);
    await browserSession.send("Target.detachFromTarget", {sessionId: attached.sessionId});
    await browserSession.detach();
});
