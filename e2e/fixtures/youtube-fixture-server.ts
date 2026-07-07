import {readFileSync} from "node:fs";
import {createServer, type IncomingMessage, type Server, type ServerResponse} from "node:https";
import type {AddressInfo} from "node:net";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const FIXTURE_VIDEO_ID = "dQw4w9WgXcQ";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_SEGMENTS = [
    "We begin with a local transcript fixture.",
    "The page is served by a deterministic HTTP server.",
    "The MAIN world interceptor observes the player request.",
    "The isolated bridge forwards captures to the service worker.",
    "The MV3 service worker records the player payload.",
    "It also records transcript cues from youtubei.",
    "The correlator joins both halves by video id.",
    "The side panel receives an intercepted transcript message.",
    "No external media website is involved in this test.",
    "The popup path comes from the extension manifest.",
    "Artifacts are retained when this gate fails.",
    "This final cue proves the list has enough rows.",
] as const;

export interface YouTubeFixtureServer {
    readonly baseUrl: string;
    readonly originHost: string;
    readonly port: number;
    close(): Promise<void>;
}

function json(response: ServerResponse, payload: unknown): void {
    response.writeHead(200, {
        "access-control-allow-origin": "*",
        "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(payload));
}

function notFound(response: ServerResponse): void {
    response.writeHead(404, {"content-type": "text/plain; charset=utf-8"});
    response.end("not found");
}

function readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        request.on("error", reject);
    });
}

function timedTextPayload(): Record<string, unknown> {
    return {
        events: FIXTURE_SEGMENTS.map((text, index) => ({
            tStartMs: index * 2_000,
            dDurationMs: 1_500,
            segs: [{utf8: text}],
        })),
    };
}

function getTranscriptPayload(): Record<string, unknown> {
    return {
        actions: [
            {
                updateEngagementPanelAction: {
                    content: {
                        transcriptRenderer: {
                            content: {
                                transcriptSearchPanelRenderer: {
                                    body: {
                                        transcriptSegmentListRenderer: {
                                            initialSegments: FIXTURE_SEGMENTS.map((text, index) => ({
                                                transcriptSegmentRenderer: {
                                                    snippet: {runs: [{text}]},
                                                    startMs: String(index * 2_000),
                                                    endMs: String(index * 2_000 + 1_500),
                                                },
                                            })),
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        ],
    };
}

function playerPayload(port: number): Record<string, unknown> {
    return {
        playabilityStatus: {status: "OK"},
        videoDetails: {
            title: "Local Fixture Transcript",
            shortDescription: "0:00 Intro\n0:10 Verification",
            defaultAudioLanguage: "en",
        },
        captions: {
            playerCaptionsTracklistRenderer: {
                captionTracks: [
                    {
                        baseUrl: `https://www.youtube.com:${port}/api/timedtext?v=${FIXTURE_VIDEO_ID}&lang=en`,
                        languageCode: "en",
                        kind: "asr",
                        name: {simpleText: "English"},
                    },
                ],
            },
        },
    };
}

function watchPage(port: number): string {
    const playerJson = JSON.stringify(playerPayload(port));
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Local YouTube Fixture</title>
  </head>
  <body>
    <main>
      <h1>Local Fixture Transcript</h1>
      <video controls width="320" height="180" aria-label="Fixture media"></video>
      <button type="button" aria-label="Show transcript">Show transcript</button>
    </main>
    <script>
      var ytInitialPlayerResponse = ${playerJson};
      var ytFixtureReady = true;

      function transcriptParams(videoId) {
        return btoa(String.fromCharCode(10, videoId.length) + videoId);
      }

      async function runFixtureRequests() {
        await fetch("/youtubei/v1/player?prettyPrint=false", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            context: {client: {clientName: "WEB", clientVersion: "fixture"}},
            videoId: "${FIXTURE_VIDEO_ID}"
          })
        });
        await fetch("/youtubei/v1/get_transcript?prettyPrint=false", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({
            context: {client: {clientName: "WEB", clientVersion: "fixture"}},
            params: transcriptParams("${FIXTURE_VIDEO_ID}")
          })
        });
      }

      window.addEventListener("DOMContentLoaded", () => {
        setTimeout(() => void runFixtureRequests(), 0);
      });
    </script>
  </body>
</html>`;
}

async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    port: number,
): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "www.youtube.com"}`);
    if (request.method === "OPTIONS") {
        response.writeHead(204, {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET,POST,OPTIONS",
            "access-control-allow-headers": "content-type",
        });
        response.end();
        return;
    }
    if (url.pathname === "/watch") {
        response.writeHead(200, {"content-type": "text/html; charset=utf-8"});
        response.end(watchPage(port));
        return;
    }
    if (url.pathname === "/youtubei/v1/player") {
        await readBody(request);
        json(response, playerPayload(port));
        return;
    }
    if (url.pathname === "/youtubei/v1/get_transcript") {
        await readBody(request);
        json(response, getTranscriptPayload());
        return;
    }
    if (url.pathname === "/api/timedtext") {
        json(response, timedTextPayload());
        return;
    }
    if (url.pathname === "/favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
    }
    notFound(response);
}

export async function startYouTubeFixtureServer(): Promise<YouTubeFixtureServer> {
    let activePort = 0;
    const server: Server = createServer(
        {
            cert: readFileSync(path.join(__dirname, "certs/youtube-fixture.crt")),
            key: readFileSync(path.join(__dirname, "certs/youtube-fixture.key")),
        },
        (request, response) => {
            void handleRequest(request, response, activePort).catch((error: unknown) => {
                response.writeHead(500, {"content-type": "text/plain; charset=utf-8"});
                response.end(error instanceof Error ? error.message : String(error));
            });
        },
    );

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
        });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Fixture server did not expose a TCP port.");
    }
    activePort = (address as AddressInfo).port;

    return {
        baseUrl: `https://www.youtube.com:${activePort}`,
        originHost: "www.youtube.com",
        port: activePort,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error?: Error) => {
                    if (error) reject(error);
                    else resolve();
                });
            }),
    };
}
