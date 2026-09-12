import {defineConfig} from "@playwright/test";

// Store screenshots are generated, not tested: one worker, no retries, no reports.
export default defineConfig({
    testDir: ".",
    testMatch: /screenshots\.ts$/,
    timeout: 120_000,
    workers: 1,
    reporter: [["list"]],
    outputDir: "../../test-results/store-images",
    use: {screenshot: "off", trace: "off", video: "off"},
});
