import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.E2E_PORT ?? "4173";
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "deployed/**",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: `pnpm --filter @y7-feedback/config build && pnpm --filter @y7-feedback/domain build && pnpm build && pnpm preview --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    env: {
      VITE_Y7_ENVIRONMENT: "development",
      VITE_APPWRITE_ENVIRONMENT: "development",
      VITE_APPWRITE_ENDPOINT: "http://127.0.0.1/v1",
      VITE_APPWRITE_PROJECT_ID: "feedback-e2e",
      VITE_API_ENDPOINT: "http://127.0.0.1:8787/",
      VITE_RELEASE: "e2e",
    },
    url: e2eBaseUrl,
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
