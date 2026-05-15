import {defineConfig} from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    timeout: 90_000,
    expect: {timeout: 15_000},
    fullyParallel: false,
    workers: 1,
    reporter: [["list"]],
    use: {
        actionTimeout: 10_000,
        navigationTimeout: 30_000,
    },
});
