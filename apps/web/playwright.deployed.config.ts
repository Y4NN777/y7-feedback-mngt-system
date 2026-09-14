import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.Y7_DEPLOYED_PREVIEW_URL;
if (!baseURL) throw new Error("DEPLOYED_PREVIEW_URL_REQUIRED");

export default defineConfig({
  testDir: "./e2e/deployed",
  fullyParallel: false,
  globalSetup: "./e2e/deployed/setup.ts",
  globalTeardown: "./e2e/deployed/teardown.ts",
  reporter: "line",
  retries: 0,
  timeout: 45_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
  },
  workers: 1,
});
