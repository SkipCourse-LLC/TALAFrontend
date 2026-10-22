import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.unit.ts",
  workers: 1,
  timeout: 15_000,
  reporter: "line",
  outputDir: "../../test-results/independent-api",
  use: { trace: "off", screenshot: "off", video: "off" },
});
