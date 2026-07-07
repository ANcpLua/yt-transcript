import {defineConfig} from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    timeout: 90_000,
    expect: {timeout: 15_000},
    fullyParallel: false,
    workers: 1,
    reporter: [
        ["list"],
        ["html", {outputFolder: "playwright-report/e2e", open: "never"}],
        ["json", {outputFile: "test-results/e2e-results.json"}],
    ],
    outputDir: "test-results/e2e-artifacts",
    use: {
        actionTimeout: 10_000,
        navigationTimeout: 30_000,
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
        video: "retain-on-failure",
    },
});
