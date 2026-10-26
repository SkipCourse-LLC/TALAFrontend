import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

export default defineConfig({
  testDir: ".",
  testMatch: "workspaceUpdates.browser.ts",
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  outputDir: "../../test-results/workspace-updates",
  use: {
    baseURL: "http://127.0.0.1:5186",
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/Phoenix",
    reducedMotion: "reduce",
    actionTimeout: 10_000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --mode api --host 127.0.0.1 --port 5186 --strictPort",
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    url: "http://127.0.0.1:5186",
    reuseExistingServer: false,
    env: {
      VITE_BACKEND_MODE: "api",
      VITE_DEMO_MODE: "false",
      VITE_DEMO_TOOLS: "false",
    },
    timeout: 30_000,
    stdout: "ignore",
    stderr: "ignore",
  },
});
