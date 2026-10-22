import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "meetingHelpers.unit.ts",
  workers: 1,
  retries: 0,
  timeout: 15_000,
  reporter: "line",
  outputDir: "../../test-results/independent-meetings",
  use: { trace: "off", screenshot: "off", video: "off" },
});
