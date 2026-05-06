// Loads the unpacked extension in Chrome for Testing, opens the side
// panel HTML first (so its chrome.runtime listeners are live), then
// navigates a sibling tab to a YouTube watch page and waits for the
// 'intercepted-transcript' broadcast to populate the panel.

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";

const EXTENSION_PATH = "/Users/ancplua/yt-transcript/dist";
const PROFILE_DIR = "/tmp/yt-test-profile";
const OUT_DIR = "/tmp/yt-screenshots";
mkdirSync(OUT_DIR, { recursive: true });

// Two test videos:
//   - jNQXAC9IVRw  "Me at the zoo" (YouTube's first video, ungated, captions)
//   - cPoEFM1AKE4  the user's failing case
const VIDEOS = (process.env.TEST_VIDEOS || "jNQXAC9IVRw,cPoEFM1AKE4").split(",");

if (!existsSync(EXTENSION_PATH)) {
  console.error("dist not found at", EXTENSION_PATH);
  process.exit(1);
}

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  channel: "chromium",
  args: [
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=DialMediaRouteProvider",
    "--lang=en-US",
  ],
  viewport: { width: 1280, height: 800 },
  locale: "en-US",
});

// Pre-set consent cookies so YouTube doesn't redirect us to its
// consent.youtube.com wall, which prevents /youtubei/v1/player from
// firing at all.
await context.addCookies([
  { name: "CONSENT", value: "YES+cb.20210328-17-p0.en+FX+782", domain: ".youtube.com", path: "/" },
  { name: "SOCS", value: "CAISEwgDEgk0NjU0MjE2NzAaAmRlIAEaBgiAvL2hBg", domain: ".youtube.com", path: "/" },
  { name: "VISITOR_INFO1_LIVE", value: "TestVisitor123", domain: ".youtube.com", path: "/" },
  { name: "PREF", value: "tz=America.Los_Angeles&hl=en", domain: ".youtube.com", path: "/" },
]);

let [serviceWorker] = context.serviceWorkers();
if (!serviceWorker) serviceWorker = await context.waitForEvent("serviceworker");
const extensionId = serviceWorker.url().split("/")[2];
console.log("[bg] extension id:", extensionId);

// Tee SW console output so we can see correlator/auto-fetch logs.
serviceWorker.on("console", (msg) => {
  console.log(`[sw/${msg.type()}]`, msg.text());
});

const sidePanelUrl = `chrome-extension://${extensionId}/sidepanel/index.html`;
const panelPage = await context.newPage();
await panelPage.setViewportSize({ width: 420, height: 900 });
panelPage.on("console", (msg) => {
  const t = msg.type();
  if (t === "error" || t === "warning" || t === "info") {
    console.log(`[panel/${t}]`, msg.text());
  }
});
await panelPage.goto(sidePanelUrl, { waitUntil: "domcontentloaded" });
console.log("[panel] open");

const watchPage = context.pages().find((p) => p !== panelPage) ?? await context.newPage();

for (const videoId of VIDEOS) {
  console.log(`\n=== ${videoId} ===`);
  const seenUrls = new Set();
  const onReq = (req) => {
    const u = req.url();
    if (
      u.includes("/youtubei/v1/player") ||
      u.includes("/youtubei/v1/get_transcript") ||
      u.includes("/api/timedtext")
    ) {
      const tag = u.split("?")[0].split("/").slice(-2).join("/");
      if (!seenUrls.has(tag)) {
        seenUrls.add(tag);
        console.log("  [net]", req.method(), tag);
      }
    }
  };
  watchPage.on("request", onReq);

  await watchPage.goto(`https://www.youtube.com/watch?v=${videoId}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  // Belt-and-suspenders: dismiss any consent dialog still on screen.
  try {
    const consent = await watchPage
      .locator('button:has-text("Reject all"), button:has-text("Accept all")')
      .first();
    if (await consent.isVisible({ timeout: 2500 })) {
      await consent.click();
      console.log("  [yt] consent dismissed");
      await watchPage.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    }
  } catch { /* nothing visible */ }

  await watchPage.waitForSelector("video", { timeout: 15_000 }).catch(() => {});
  await watchPage.waitForTimeout(6000);

  // Diagnostics — was the MAIN-world interceptor actually injected?
  try {
    const loaded = await watchPage.evaluate(() => (window).__ytTxLoaded ?? null);
    console.log("  [diag] __ytTxLoaded =", loaded);
    const fetchPatched = await watchPage.evaluate(() => String(window.fetch).includes("patchedFetch"));
    console.log("  [diag] fetch patched =", fetchPatched);

    // Hard ground truth: ask Playwright's CDP directly what hit the network.
    const cdp = await watchPage.context().newCDPSession(watchPage);
    // Already passed; just enumerate the buffer.
    const ytApi = (await watchPage.evaluate(async () => {
      // Issue a fetch we control to confirm /youtubei/v1/player works at all.
      try {
        const r = await fetch("/youtubei/v1/player?prettyPrint=false", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: { client: { clientName: "WEB", clientVersion: "2.20260330.00.00" } },
            videoId: "jNQXAC9IVRw",
          }),
        });
        const t = await r.text();
        return { status: r.status, len: t.length, snippet: t.slice(0, 200) };
      } catch (e) {
        return { error: e.message };
      }
    }));
    console.log("  [diag] manual /player fetch:", JSON.stringify(ytApi).slice(0, 300));
    await cdp.detach().catch(() => {});
  } catch (e) {
    console.log("  [diag] eval error", e?.message ?? e);
  }

  const outcome = await Promise.race([
    panelPage
      .waitForFunction(() => {
        const root = document.querySelector("#root");
        if (!root) return false;
        const t = root.textContent || "";
        if (t.includes("Couldn't fetch")) return "error";
        if (t.includes("No transcript")) return "no-captions";
        if (t.includes("Transcribing")) return "transcribing";
        if (root.querySelector("article, [data-testid='transcript-view']")) return "transcript";
        if (t.match(/\bLive\b/)) return "live-pill";
        return false;
      }, { timeout: 20_000 })
      .then((r) => r.jsonValue()),
    new Promise((r) => setTimeout(() => r("timeout"), 22_000)),
  ]);
  console.log("  [panel] outcome:", outcome);

  await panelPage.screenshot({
    path: `${OUT_DIR}/panel-${videoId}.png`,
    fullPage: false,
  });
  await watchPage.screenshot({
    path: `${OUT_DIR}/watch-${videoId}.png`,
    fullPage: false,
  });

  const panelText = await panelPage.evaluate(() => {
    const r = document.querySelector("#root");
    return r ? (r.textContent || "").replace(/\s+/g, " ").slice(0, 400) : "";
  });
  console.log("  [panel/text]", panelText);

  watchPage.off("request", onReq);
}

// Bonus: open the Settings modal and screenshot it.
console.log("\n=== Settings panel ===");
await panelPage.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button"))
    .find((b) => b.title === "Settings");
  btn?.click();
});
await panelPage.waitForTimeout(1500);
await panelPage.screenshot({
  path: `${OUT_DIR}/settings.png`,
  fullPage: false,
});
const settingsText = await panelPage.evaluate(() => {
  const r = document.querySelector("#root");
  return r ? (r.textContent || "").replace(/\s+/g, " ").slice(0, 600) : "";
});
console.log("  [settings/text]", settingsText);

// Close settings.
await panelPage.evaluate(() => {
  const close = Array.from(document.querySelectorAll("button"))
    .find((b) => b.getAttribute("aria-label") === "Close");
  close?.click();
});
await panelPage.waitForTimeout(500);

// Bonus: click "Transcribe locally" to prove Whisper boots without the
// CSP / "Unsupported model type: whisper" error that used to happen
// when transformers.js tried to load ORT from jsdelivr.
console.log("\n=== Transcribe locally ===");
const tryClick = await panelPage.evaluate(() => {
  for (const b of document.querySelectorAll("button")) {
    if ((b.textContent || "").trim() === "Transcribe locally") {
      b.click();
      return true;
    }
  }
  return false;
});
console.log("  [whisper] clicked:", tryClick);
// Listen for whisper download / model load progress messages.
const whisperLogs = [];
serviceWorker.on("console", (msg) => {
  const t = msg.text();
  if (/whisper|transformers|onnx/i.test(t)) whisperLogs.push(t);
});
await panelPage.waitForTimeout(20000);
await panelPage.screenshot({ path: `${OUT_DIR}/whisper.png`, fullPage: false });
const whisperText = await panelPage.evaluate(() => {
  const r = document.querySelector("#root");
  return r ? (r.textContent || "").replace(/\s+/g, " ").slice(0, 600) : "";
});
console.log("  [whisper/text]", whisperText);
console.log("  [whisper/logs]", whisperLogs.slice(0, 10));

await context.close();
console.log("\ndone. screenshots:", OUT_DIR);
