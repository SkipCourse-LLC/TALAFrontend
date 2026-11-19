import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

// The tests intercept every /api call, so no backend runs.
export default defineConfig({
  testDir: ".",
  testMatch: "onboarding.browser.ts",
  workers: 1,
  timeout: 30_000,
  reporter: "line",
  outputDir: "../../test-results/onboarding",
  use: {
    baseURL: "http://127.0.0.1:5195",
    browserName: "chromium",
    timezoneId: "America/Phoenix",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command:
      "node node_modules/vite/bin/vite.js --mode api --host 127.0.0.1 --port 5195 --strictPort",
    env: {
      VITE_BACKEND_MODE: "api",
      VITE_DEMO_MODE: "false",
      VITE_DEMO_TOOLS: "false",
    },
    url: "http://127.0.0.1:5195",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
