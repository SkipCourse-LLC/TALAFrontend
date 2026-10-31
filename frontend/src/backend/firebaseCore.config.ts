import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "firebaseCore.unit.ts",
  workers: 1,
  timeout: 15_000,
  reporter: "line",
  outputDir: "../../test-results/firebase-core",
  use: { trace: "off", screenshot: "off", video: "off" },
});
