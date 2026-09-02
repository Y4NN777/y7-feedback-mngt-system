import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["grain.svg", "y7-mark.svg"],
      manifest: {
        name: "Y7 Feedback",
        short_name: "Y7 Feedback",
        description: "Collect, follow, and work with product feedback.",
        theme_color: "#4f5a2e",
        background_color: "#e8dcc7",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/y7-mark.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{css,html,js,svg,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        skipWaiting: false,
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    css: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
