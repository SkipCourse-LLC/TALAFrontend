import { defineConfig } from "@playwright/test";
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
export default defineConfig({
  testDir: ".",
  testMatch: "demoMeetings.browser.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 45_000,
  outputDir: "../../test-results/demo-meetings",
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run dev:demo -- --port 5173 --strictPort",
    cwd: "../..",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    env: {
      VITE_BACKEND_MODE: "demo",
      VITE_DEMO_MODE: "true",
      VITE_DEMO_TOOLS: "false",
    },
  },
});
