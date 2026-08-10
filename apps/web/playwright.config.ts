import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm build && pnpm preview --host 127.0.0.1",
    env: {
      VITE_Y7_ENVIRONMENT: "development",
      VITE_APPWRITE_ENVIRONMENT: "development",
      VITE_APPWRITE_ENDPOINT: "http://127.0.0.1/v1",
      VITE_APPWRITE_PROJECT_ID: "feedback-e2e",
      VITE_API_ENDPOINT: "http://127.0.0.1:8787/",
      VITE_RELEASE: "e2e",
    },
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-320",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 720 },
      },
    },
  ],
});
